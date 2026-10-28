const crypto = require('crypto');

// 32 random bytes = 256 bits; base64url gives a 43-character URL-safe string
const newToken = () => crypto.randomBytes(32).toString('base64url');
const hashToken = (token) => crypto.createHash('sha256').update(token).digest('hex');
const looksLikeToken = (t) => typeof t === 'string' && /^[A-Za-z0-9_-]{43}$/.test(t);

module.exports = { newToken, hashToken, looksLikeToken };
