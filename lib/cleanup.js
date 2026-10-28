const fs = require('fs');
const path = require('path');
const db = require('../db');
const { UPLOAD_DIR } = require('../config');

// Delete files in uploads/ that have no database row (left behind by aborted uploads or crashes).
// Skips very recent files so an upload in progress is never removed.
function sweepOrphans() {
  const known = new Set(db.prepare('SELECT stored_name FROM files').all().map((r) => r.stored_name));
  let removed = 0;
  for (const name of fs.readdirSync(UPLOAD_DIR)) {
    if (known.has(name)) continue;
    const p = path.join(UPLOAD_DIR, name);
    try {
      if (Date.now() - fs.statSync(p).mtimeMs < 10 * 60 * 1000) continue;
      fs.unlinkSync(p);
      removed++;
    } catch { /* ignore */ }
  }
  return removed;
}

module.exports = { sweepOrphans };
