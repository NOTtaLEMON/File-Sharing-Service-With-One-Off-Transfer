const fs = require('fs');
const path = require('path');

// extension -> canonical mime we store (never trust the client's mimetype)
const TYPES = {
  pdf: 'application/pdf',
  txt: 'text/plain',
  zip: 'application/zip',
  docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
  pptx: 'application/vnd.openxmlformats-officedocument.presentationml.presentation',
  // images (SVG is deliberately left out: it is XML that can carry scripts)
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  jpe: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
  tif: 'image/tiff',
  tiff: 'image/tiff',
  ico: 'image/x-icon',
  avif: 'image/avif',
  heic: 'image/heic',
  heif: 'image/heif',
};

const startsWith = (head, bytes, at = 0) => bytes.every((b, i) => head[at + i] === b);
const ascii = (s) => [...s].map((c) => c.charCodeAt(0));
const brandAt4 = (head, brands) =>
  head.length >= 12 && startsWith(head, ascii('ftyp'), 4) && brands.includes(head.subarray(8, 12).toString('latin1'));

const ZIP = (h) => startsWith(h, [0x50, 0x4b, 0x03, 0x04]);
const JPEG = (h) => startsWith(h, [0xff, 0xd8, 0xff]);
const TIFF = (h) => startsWith(h, [0x49, 0x49, 0x2a, 0x00]) || startsWith(h, [0x4d, 0x4d, 0x00, 0x2a]);
const HEIF = (h) => brandAt4(h, ['heic', 'heix', 'hevc', 'hevx', 'heim', 'heis', 'mif1', 'msf1']);

// Does the file's real first bytes match what its extension claims?
const CHECKS = {
  pdf: (h) => startsWith(h, ascii('%PDF-')),
  txt: (h) => !h.includes(0), // binary data is not text
  zip: ZIP,
  docx: ZIP,
  pptx: ZIP,
  png: (h) => startsWith(h, [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
  jpg: JPEG,
  jpeg: JPEG,
  jpe: JPEG,
  gif: (h) => startsWith(h, ascii('GIF87a')) || startsWith(h, ascii('GIF89a')),
  webp: (h) => startsWith(h, ascii('RIFF')) && startsWith(h, ascii('WEBP'), 8),
  bmp: (h) => startsWith(h, ascii('BM')),
  tif: TIFF,
  tiff: TIFF,
  ico: (h) => startsWith(h, [0x00, 0x00, 0x01, 0x00]),
  avif: (h) => brandAt4(h, ['avif', 'avis', 'mif1', 'msf1']),
  heic: HEIF,
  heif: HEIF,
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
  return CHECKS[ext](buf.subarray(0, n)) ? TYPES[ext] : null;
}

module.exports = { TYPES, extOf, cleanName, sniff };
