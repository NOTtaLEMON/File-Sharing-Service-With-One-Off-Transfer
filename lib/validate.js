const fs = require('fs');
const path = require('path');

// extension -> canonical mime we store (never trust the client's mimetype)
const TYPES = {
  pdf: 'application/pdf',
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  txt: 'text/plain',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
};

const MAGIC = {
  pdf: [Buffer.from('%PDF-')],
  png: [Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a])],
  jpg: [Buffer.from([0xff, 0xd8, 0xff])],
  jpeg: [Buffer.from([0xff, 0xd8, 0xff])],
  zip: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
  docx: [Buffer.from([0x50, 0x4b, 0x03, 0x04])],
};

function extOf(name) {
  return path.extname(name).slice(1).toLowerCase();
}

// Strip any path, control characters and quotes; cap length. Used for display only.
function cleanName(name) {
  const base = String(name).split(/[\\/]/).pop();
  const cleaned = base.replace(/[\x00-\x1f\x7f"<>:|?*]/g, '').trim().slice(0, 150);
  return cleaned || 'file';
}

// Returns the canonical mime if the file's real bytes match its extension, else null.
function sniff(filePath, ext) {
  if (!TYPES[ext]) return null;
  const fd = fs.openSync(filePath, 'r');
  const buf = Buffer.alloc(512);
  let n;
  try {
    n = fs.readSync(fd, buf, 0, 512, 0);
  } finally {
    fs.closeSync(fd);
  }
  if (n === 0) return null; // empty file
  const head = buf.subarray(0, n);
  if (ext === 'txt') return head.includes(0) ? null : TYPES.txt; // binary data is not text
  const ok = MAGIC[ext].some((m) => head.subarray(0, m.length).equals(m));
  return ok ? TYPES[ext] : null;
}

module.exports = { TYPES, extOf, cleanName, sniff };
