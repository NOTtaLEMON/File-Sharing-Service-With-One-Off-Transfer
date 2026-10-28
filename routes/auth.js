const express = require('express');
const bcrypt = require('bcryptjs');
const jwt = require('jsonwebtoken');
const rateLimit = require('express-rate-limit');
const db = require('../db');
const { JWT_SECRET, QUOTA_BYTES } = require('../config');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();
const limiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 30, standardHeaders: true, legacyHeaders: false });

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

function startSession(res, user) {
  const token = jwt.sign({ id: user.id, email: user.email }, JWT_SECRET, { expiresIn: '1d' });
  res.cookie('session', token, {
    httpOnly: true,
    sameSite: 'strict',
    secure: process.env.NODE_ENV === 'production',
    maxAge: 24 * 60 * 60 * 1000,
  });
}

router.post('/register', limiter, (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  if (!EMAIL_RE.test(email) || email.length > 200) return res.status(400).json({ error: 'Enter a valid email' });
  if (password.length < 8 || password.length > 100) return res.status(400).json({ error: 'Password must be 8-100 characters' });
  if (db.prepare('SELECT 1 FROM users WHERE email = ?').get(email)) {
    return res.status(409).json({ error: 'Email already registered' });
  }
  const hash = bcrypt.hashSync(password, 10);
  const info = db.prepare('INSERT INTO users (email, password_hash) VALUES (?, ?)').run(email, hash);
  startSession(res, { id: info.lastInsertRowid, email });
  res.status(201).json({ email });
});

router.post('/login', limiter, (req, res) => {
  const email = String((req.body && req.body.email) || '').trim().toLowerCase();
  const password = String((req.body && req.body.password) || '');
  const user = db.prepare('SELECT * FROM users WHERE email = ?').get(email);
  // same message for unknown email and wrong password
  if (!user || !bcrypt.compareSync(password, user.password_hash)) {
    return res.status(401).json({ error: 'Wrong email or password' });
  }
  startSession(res, user);
  res.json({ email: user.email });
});

router.post('/logout', (req, res) => {
  res.clearCookie('session');
  res.json({ ok: true });
});

// mounted at /api/me
const me = express.Router();
me.get('/', requireAuth, (req, res) => {
  const row = db.prepare('SELECT COALESCE(SUM(size), 0) AS used FROM files WHERE owner_id = ?').get(req.user.id);
  res.json({ email: req.user.email, used_bytes: row.used, quota_bytes: QUOTA_BYTES });
});

module.exports = { router, me };
