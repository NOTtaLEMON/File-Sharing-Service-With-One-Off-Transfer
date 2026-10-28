// STUB for teammate B (links, token hashing, revoke).
// Mounted at /api by server.js. Uses requireAuth; always check file.owner_id === req.user.id.
//   POST /api/files/:id/links   body {expires_in: seconds}  -> {id, url, expires_at}   (url shown ONCE; store only the token hash)
//   POST /api/links/:id/revoke                               -> {ok: true}
const express = require('express');
const { requireAuth } = require('../middleware/auth');

const router = express.Router();

router.post('/files/:id/links', requireAuth, (req, res) => res.status(501).json({ error: 'Not implemented yet' }));
router.post('/links/:id/revoke', requireAuth, (req, res) => res.status(501).json({ error: 'Not implemented yet' }));

module.exports = router;
