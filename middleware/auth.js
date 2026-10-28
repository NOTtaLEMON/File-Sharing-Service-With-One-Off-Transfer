const jwt = require('jsonwebtoken');
const { JWT_SECRET } = require('../config');

// Sets req.user = { id, email } or responds 401.
function requireAuth(req, res, next) {
  const token = req.cookies && req.cookies.session;
  if (!token) return res.status(401).json({ error: 'Not logged in' });
  try {
    const p = jwt.verify(token, JWT_SECRET);
    req.user = { id: p.id, email: p.email };
    next();
  } catch {
    res.status(401).json({ error: 'Session expired, please log in again' });
  }
}

module.exports = { requireAuth };
