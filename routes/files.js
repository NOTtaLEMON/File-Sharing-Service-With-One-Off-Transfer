const express = require('express');
const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const multer = require('multer');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { UPLOAD_DIR, MAX_FILE_BYTES, QUOTA_BYTES } = require('../config');
const { requireAuth } = require('../middleware/auth');
const { TYPES, extOf, cleanName, sniff } = require('../lib/validate');

const router = express.Router();
router.use(requireAuth);

const uploadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 20, standardHeaders: true, legacyHeaders: false });

const usedBytes = (userId) =>
  db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE owner_id = ?').get(userId).used;

const storage = multer.diskStorage({
  destination: UPLOAD_DIR,
  // random name, no extension: the original name never touches the filesystem
  filename: (req, file, cb) => cb(null, crypto.randomUUID()),
});

const upload = multer({
  storage,
  limits: { fileSize: MAX_FILE_BYTES, files: 1 }, // enforced while streaming
  fileFilter: (req, file, cb) => {
    if (!TYPES[extOf(file.originalname)]) {
      const err = new Error('File type not allowed. Allowed: ' + Object.keys(TYPES).join(', '));
      err.status = 415;
      return cb(err);
    }
    cb(null, true);
  },
}).single('file');

function removeQuietly(p) {
  try { fs.unlinkSync(p); } catch { /* already gone */ }
}

router.post('/', uploadLimiter, (req, res) => {
  // cheap early reject before reading the body
  if (usedBytes(req.user.id) >= QUOTA_BYTES) {
    return res.status(413).json({ error: 'Storage quota full. Delete a file first.' });
  }
  upload(req, res, (err) => {
    if (err) {
      if (err.code === 'LIMIT_FILE_SIZE') {
        return res.status(413).json({ error: `File too large (max ${MAX_FILE_BYTES / 1024 / 1024} MB)` });
      }
      return res.status(err.status || 400).json({ error: err.message || 'Upload failed' });
    }
    if (!req.file) return res.status(400).json({ error: 'No file received' });

    const ext = extOf(req.file.originalname);
    const mime = sniff(req.file.path, ext);
    if (!mime) {
      removeQuietly(req.file.path);
      return res.status(415).json({ error: 'File contents do not match its type' });
    }

    // quota check + insert in one transaction so two uploads can't both slip past
    const tx = db.transaction(() => {
      if (usedBytes(req.user.id) + req.file.size > QUOTA_BYTES) return null;
      const info = db
        .prepare('INSERT INTO files (owner_id, original_name, stored_name, mime, size) VALUES (?, ?, ?, ?, ?)')
        .run(req.user.id, cleanName(req.file.originalname), req.file.filename, mime, req.file.size);
      return info.lastInsertRowid;
    });
    const id = tx();
    if (id === null) {
      removeQuietly(req.file.path);
      return res.status(413).json({ error: 'This upload would exceed your storage quota' });
    }
    res.status(201).json({ id, name: cleanName(req.file.originalname), size: req.file.size });
  });
});

router.get('/', (req, res) => {
  const files = db
    .prepare('SELECT id, original_name AS name, size, mime, created_at FROM files WHERE owner_id = ? ORDER BY id DESC')
    .all(req.user.id);
  const links = db
    .prepare(
      `SELECT l.id, l.file_id, l.expires_at, l.revoked_at, l.download_count
       FROM links l JOIN files f ON f.id = l.file_id WHERE f.owner_id = ? ORDER BY l.id DESC`
    )
    .all(req.user.id);
  const now = new Date().toISOString();
  for (const f of files) {
    f.links = links
      .filter((l) => l.file_id === f.id)
      .map((l) => ({
        id: l.id,
        expires_at: l.expires_at,
        download_count: l.download_count,
        status: l.revoked_at ? 'revoked' : l.expires_at <= now ? 'expired' : 'active',
      }));
  }
  res.json(files);
});

router.delete('/:id', (req, res) => {
  // owner_id is part of the query: someone else's file looks like "not found"
  const file = db.prepare('SELECT id, stored_name FROM files WHERE id = ? AND owner_id = ?').get(req.params.id, req.user.id);
  if (!file) return res.status(404).json({ error: 'File not found' });
  db.prepare('DELETE FROM files WHERE id = ?').run(file.id); // links cascade
  removeQuietly(path.join(UPLOAD_DIR, file.stored_name));
  res.json({ ok: true });
});

module.exports = router;
