// Recipient side, no login.
//   GET /api/s/:token       -> 200 {status:'ok', name, size} | 404 {status:'not_found'} | 410 {status:'expired'|'revoked'}
//   GET /s/:token/download  -> the file as an attachment, or a redirect back to the page that explains why not
// The HTML page for /s/:token is served by server.js from public/download.html.
const fs = require('fs');
const path = require('path');
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { UPLOAD_DIR } = require('../config');
const { hashToken, looksLikeToken } = require('../lib/tokens');

const router = express.Router();
const publicLimiter = rateLimit({ windowMs: 60 * 1000, limit: 60, standardHeaders: true, legacyHeaders: false });

// Returns {status, link?, file?} for a raw token. Every request re-checks revoke and expiry.
function lookup(token) {
  if (!looksLikeToken(token)) return { status: 'not_found' };
  const row = db
    .prepare(
      `SELECT l.id, l.expires_at, l.revoked_at, f.original_name, f.stored_name, f.size
       FROM links l JOIN files f ON f.id = l.file_id WHERE l.token_hash = ?`
    )
    .get(hashToken(token));
  if (!row) return { status: 'not_found' };
  if (row.revoked_at) return { status: 'revoked' };
  if (row.expires_at <= new Date().toISOString()) return { status: 'expired' };
  return { status: 'ok', row };
}

router.get('/api/s/:token', publicLimiter, (req, res) => {
  res.set('Cache-Control', 'no-store');
  const r = lookup(req.params.token);
  if (r.status === 'ok') return res.json({ status: 'ok', name: r.row.original_name, size: r.row.size });
  res.status(r.status === 'not_found' ? 404 : 410).json({ status: r.status });
});

router.get('/s/:token/download', publicLimiter, (req, res) => {
  const token = req.params.token;
  const back = '/s/' + encodeURIComponent(token);
  const r = lookup(token);
  if (r.status !== 'ok') return res.redirect(303, back);

  const filePath = path.join(UPLOAD_DIR, r.row.stored_name);
  if (!fs.existsSync(filePath)) return res.redirect(303, back);

  // count only if the link is still valid at this exact moment (guards a revoke racing the download)
  const counted = db
    .prepare('UPDATE links SET download_count = download_count + 1 WHERE id = ? AND revoked_at IS NULL AND expires_at > ?')
    .run(r.row.id, new Date().toISOString()).changes;
  if (!counted) return res.redirect(303, back);

  // Never let the browser render the file: generic type, forced download, no sniffing, sandboxed if opened.
  res.set({
    'Content-Type': 'application/octet-stream',
    'X-Content-Type-Options': 'nosniff',
    'Content-Security-Policy': "default-src 'none'; sandbox",
    'Cache-Control': 'no-store',
  });
  res.download(filePath, r.row.original_name, (err) => {
    if (err && !res.headersSent) res.status(500).send('Download failed');
  });
});

module.exports = router;
