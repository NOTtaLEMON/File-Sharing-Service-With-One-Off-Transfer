// STUB for teammate B (public recipient side, no login).
//   GET /api/s/:token       -> 200 {status:'ok', name, size}  or  {status:'expired'|'revoked'|'not_found'} (use 404/410 codes)
//   GET /s/:token/download  -> streams the file with Content-Disposition: attachment + nosniff, increments download_count
// The HTML page for /s/:token is served by server.js from public/download.html.
const express = require('express');

const router = express.Router();

router.get('/api/s/:token', (req, res) => res.status(501).json({ status: 'not_implemented' }));
router.get('/s/:token/download', (req, res) => res.status(501).send('Not implemented yet'));

module.exports = router;
