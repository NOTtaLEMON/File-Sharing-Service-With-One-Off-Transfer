const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.UPLOAD_RATE_LIMIT = '1000'; // tests upload many files quickly
process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-links-'));
const app = require('../server');
const db = require('../db');

let base, server;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; r(); }); }));
test.after(() => server.close());

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.from('pixels')]);

async function login(email) {
  const res = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  return res.headers.get('set-cookie').split(';')[0];
}
async function uploadPng(cookie) {
  const fd = new FormData();
  fd.append('file', new Blob([PNG]), 'cat.png');
  return (await (await fetch(base + '/api/files', { method: 'POST', headers: { cookie }, body: fd })).json()).id;
}
const post = (url, cookie, body) => fetch(base + url, {
  method: 'POST', headers: { cookie, 'Content-Type': 'application/json' }, body: JSON.stringify(body || {}),
});
const tokenOf = (url) => url.split('/').pop();

test('full flow: create link, view, download, count, revoke', async () => {
  const c = await login('flow@test.com');
  const id = await uploadPng(c);
  const res = await post(`/api/files/${id}/links`, c, { expires_in: 3600 });
  assert.equal(res.status, 201);
  const { url, id: linkId } = await res.json();
  const token = tokenOf(url);
  assert.match(token, /^[A-Za-z0-9_-]{43}$/);

  // the raw token is not in the database
  assert.equal(db.prepare('SELECT COUNT(*) n FROM links WHERE token_hash = ?').get(token).n, 0);

  const info = await (await fetch(`${base}/api/s/${token}`)).json();
  assert.deepEqual(info, { status: 'ok', name: 'cat.png', size: PNG.length });

  const dl = await fetch(`${base}/s/${token}/download`);
  assert.equal(dl.status, 200);
  assert.equal(dl.headers.get('content-type'), 'application/octet-stream');
  assert.equal(dl.headers.get('x-content-type-options'), 'nosniff');
  assert.match(dl.headers.get('content-disposition'), /^attachment; filename="?cat\.png"?/);
  assert.deepEqual(Buffer.from(await dl.arrayBuffer()), PNG);

  const list = await (await fetch(base + '/api/files', { headers: { cookie: c } })).json();
  assert.equal(list[0].links[0].download_count, 1);

  assert.equal((await post(`/api/links/${linkId}/revoke`, c)).status, 200);
  const after = await fetch(`${base}/api/s/${token}`);
  assert.equal(after.status, 410);
  assert.equal((await after.json()).status, 'revoked');
  const blocked = await fetch(`${base}/s/${token}/download`, { redirect: 'manual' });
  assert.equal(blocked.status, 303);
});

test('expired links are refused', async () => {
  const c = await login('exp@test.com');
  const id = await uploadPng(c);
  const { url, id: linkId } = await (await post(`/api/files/${id}/links`, c, { expires_in: 86400 })).json();
  db.prepare('UPDATE links SET expires_at = ? WHERE id = ?').run(new Date(Date.now() - 1000).toISOString(), linkId);
  const r = await fetch(`${base}/api/s/${tokenOf(url)}`);
  assert.equal(r.status, 410);
  assert.equal((await r.json()).status, 'expired');
  assert.equal((await fetch(`${base}/s/${tokenOf(url)}/download`, { redirect: 'manual' })).status, 303);
});

test('unknown and malformed tokens are not found', async () => {
  for (const t of ['A'.repeat(43), 'short', '..%2F..%2Fdb']) {
    const r = await fetch(`${base}/api/s/${t}`);
    assert.equal(r.status, 404);
  }
});

test('only allowed expiry values are accepted', async () => {
  const c = await login('ttl@test.com');
  const id = await uploadPng(c);
  for (const v of [0, 60, 999999999, 'abc']) {
    assert.equal((await post(`/api/files/${id}/links`, c, { expires_in: v })).status, 400);
  }
});

test("cannot create or revoke links on someone else's file", async () => {
  const owner = await login('own@test.com');
  const thief = await login('thief@test.com');
  const id = await uploadPng(owner);
  assert.equal((await post(`/api/files/${id}/links`, thief, { expires_in: 3600 })).status, 404);
  const { id: linkId } = await (await post(`/api/files/${id}/links`, owner, { expires_in: 3600 })).json();
  assert.equal((await post(`/api/links/${linkId}/revoke`, thief)).status, 404);
  assert.equal((await fetch(base + '/api/files/' + id + '/links', { method: 'POST' })).status, 401);
});

test('deleting a file kills its links', async () => {
  const c = await login('del@test.com');
  const id = await uploadPng(c);
  const { url } = await (await post(`/api/files/${id}/links`, c, { expires_in: 3600 })).json();
  await fetch(base + '/api/files/' + id, { method: 'DELETE', headers: { cookie: c } });
  assert.equal((await fetch(`${base}/api/s/${tokenOf(url)}`)).status, 404);
});

test('short expiry options are accepted and "expire now" ends a link', async () => {
  const c = await login('short@test.com');
  const id = await uploadPng(c);
  for (const v of [30, 300]) assert.equal((await post(`/api/files/${id}/links`, c, { expires_in: v })).status, 201);
  const { url, id: linkId } = await (await post(`/api/files/${id}/links`, c, { expires_in: 3600 })).json();
  assert.equal((await fetch(`${base}/api/s/${tokenOf(url)}`)).status, 200);
  assert.equal((await post(`/api/links/${linkId}/expire`, c)).status, 200);
  const r = await fetch(`${base}/api/s/${tokenOf(url)}`);
  assert.equal(r.status, 410);
  assert.equal((await r.json()).status, 'expired');
  const list = await (await fetch(base + '/api/files', { headers: { cookie: c } })).json();
  assert.equal(list[0].links.find((l) => l.id === linkId).status, 'expired');
});

test("cannot expire someone else's link", async () => {
  const owner = await login('own2@test.com');
  const other = await login('other2@test.com');
  const id = await uploadPng(owner);
  const { id: linkId } = await (await post(`/api/files/${id}/links`, owner, { expires_in: 3600 })).json();
  assert.equal((await post(`/api/links/${linkId}/expire`, other)).status, 404);
  assert.equal((await fetch(base + `/api/links/${linkId}/expire`, { method: 'POST' })).status, 401);
});
