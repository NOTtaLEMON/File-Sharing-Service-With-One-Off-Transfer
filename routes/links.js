// Owner-side link management. Mounted at /api by server.js.
//   POST /api/files/:id/links   body {expires_in: seconds}  -> {id, url, expires_at}   (url shown ONCE)
//   POST /api/links/:id/revoke                               -> {ok: true}
const express = require('express');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { requireAuth } = require('../middleware/auth');
const { newToken, hashToken } = require('../lib/tokens');

const router = express.Router();
const ALLOWED_EXPIRY = [30, 300, 3600, 86400, 604800]; // 30 s, 5 min, 1 hour, 1 day, 7 days
const linkLimiter = rateLimit({ windowMs: 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

router.post('/files/:id/links', requireAuth, linkLimiter, (req, res) => {
  const secs = Number(req.body && req.body.expires_in);
  if (!ALLOWED_EXPIRY.includes(secs)) {
    return res.status(400).json({ error: 'Expiry must be 30 seconds, 5 minutes, 1 hour, 1 day or 7 days' });
  }
  // owner_id in the query: someone else's file looks like "not found"
  const file = db.prepare('SELECT id FROM files WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File not found' });

  const token = newToken();
  const expiresAt = new Date(Date.now() + secs * 1000).toISOString();
  const info = db
    .prepare('INSERT INTO links (file_id, token_hash, expires_at) VALUES (?, ?, ?)')
    .run(file.id, hashToken(token), expiresAt);
  // the raw token exists only in this response; the database keeps the hash
  res.status(201).json({ id: info.lastInsertRowid, url: '/s/' + token, expires_at: expiresAt });
});

router.post('/links/:id/revoke', requireAuth, (req, res) => {
  const link = db
    .prepare('SELECT l.id, l.revoked_at FROM links l JOIN files f ON f.id = l.file_id WHERE l.id = ? AND f.owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  if (!link.revoked_at) {
    db.prepare('UPDATE links SET revoked_at = ? WHERE id = ?').run(new Date().toISOString(), link.id);
  }
  res.json({ ok: true });
});

// Manual expire: ends the link right now by moving its expiry to the present.
// The recipient then sees "expired" (revoke shows "revoked" instead).
router.post('/links/:id/expire', requireAuth, (req, res) => {
  const link = db
    .prepare('SELECT l.id FROM links l JOIN files f ON f.id = l.file_id WHERE l.id = ? AND f.owner_id = ?')
    .get(req.params.id, req.user.id);
  if (!link) return res.status(404).json({ error: 'Link not found' });
  const now = new Date().toISOString();
  db.prepare('UPDATE links SET expires_at = ? WHERE id = ? AND expires_at > ?').run(now, link.id, now);
  res.json({ ok: true });
});

module.exports = router;
