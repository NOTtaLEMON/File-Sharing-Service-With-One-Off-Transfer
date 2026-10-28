const path = require('path');

const DATA_DIR = process.env.DATA_DIR || path.join(__dirname, 'data');

if (process.env.NODE_ENV === 'production' && !process.env.JWT_SECRET) {
  throw new Error('JWT_SECRET must be set in production');
}

module.exports = {
  PORT: process.env.PORT || 3000,
  DATA_DIR,
  UPLOAD_DIR: path.join(DATA_DIR, 'uploads'),
  DB_PATH: path.join(DATA_DIR, 'app.db'),
  JWT_SECRET: process.env.JWT_SECRET || 'dev-only-secret-change-me',
  MAX_FILE_BYTES: 10 * 1024 * 1024, // 10 MB per file
  QUOTA_BYTES: 50 * 1024 * 1024, // 50 MB per user
  ALLOWED_EXT: ['pdf', 'png', 'jpg', 'jpeg', 'txt', 'zip', 'docx'],
};
