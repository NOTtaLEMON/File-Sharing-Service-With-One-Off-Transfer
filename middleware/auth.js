const jwt = require('jsonwebtoken');
const db = require('../db');
const { JWT_SECRET } = require('../config');

// Sets req.user = { id, email } or responds 401.
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  let p;
  try {
    p = jwt.verify(token, JWT_SECRET);
  } catch {
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  // A valid signature is not enough: the account must still exist. After a data reset (or a deleted
  // user) an old cookie would otherwise pass and then break on foreign-key constraints.
  const user = db.prepare('SELECT id, email FROM users WHERE id = ?').get(p.id);
  if (!user) {
    res.clearCookie('session');
    return res.status(401).json({ error: 'Session expired, please log in again' });
  }
  req.user = { id: user.id, email: user.email };
  next();
}

module.exports = { requireAuth };
