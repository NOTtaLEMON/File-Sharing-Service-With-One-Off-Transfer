const path = require('path');
const express = require('express');
const helmet = require('helmet');
const cookieParser = require('cookie-parser');
const { PORT } = require('./config');
require('./db'); // creates tables and folders on startup

const { router: authRoutes, me } = require('./routes/auth');
const fileRoutes = require('./routes/files');
const linkRoutes = require('./routes/links');
const publicRoutes = require('./routes/public');

const app = express();
app.disable('x-powered-by');
app.set('trust proxy', 1); // behind Render/Railway proxy, so rate limits see real IPs
app.use(helmet()); // default CSP: scripts only from our own origin, so no inline <script>
app.use(express.json({ limit: '10kb' }));
app.use(cookieParser());

app.get('/api/health', (req, res) => res.json({ ok: true }));
app.use('/api/auth', authRoutes);
app.use('/api/me', me);
app.use('/api/files', fileRoutes);
app.use('/api', linkRoutes);
app.use(publicRoutes);

// recipient page; the token is read from the URL by the page's script
app.get('/s/:token', (req, res) => res.sendFile(path.join(__dirname, 'public', 'download.html')));

// only public/ is served statically. uploads live in data/ and are never exposed directly.
app.use(express.static(path.join(__dirname, 'public')));

app.use('/api', (req, res) => res.status(404).json({ error: 'Not found' }));
app.use((err, req, res, next) => {
  console.error(err);
  res.status(500).json({ error: 'Something went wrong' });
});

// Last-resort safety net: log stray errors instead of letting one bad request take the whole service down.
process.on('uncaughtException', (err) => console.error('uncaughtException:', err));
process.on('unhandledRejection', (err) => console.error('unhandledRejection:', err));

if (require.main === module) {
  const { sweep } = require('./lib/cleanup');
  sweep();
  setInterval(sweep, 60 * 60 * 1000).unref();
  app.listen(PORT, () => console.log(`Listening on http://localhost:${PORT}`));
}
module.exports = app;
