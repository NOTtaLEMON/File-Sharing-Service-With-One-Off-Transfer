const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const fs = require('fs');
const path = require('path');

process.env.DATA_DIR = fs.mkdtempSync(path.join(os.tmpdir(), 'fs-test-'));
const app = require('../server');

let base, server;
test.before(() => new Promise((r) => { server = app.listen(0, () => { base = 'http://127.0.0.1:' + server.address().port; r(); }); }));
test.after(() => server.close());

async function login(email) {
  const res = await fetch(base + '/api/auth/register', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ email, password: 'password123' }),
  });
  assert.equal(res.status, 201);
  return res.headers.get('set-cookie').split(';')[0];
}

function upload(cookie, name, bytes) {
  const fd = new FormData();
  fd.append('file', new Blob([bytes]), name);
  return fetch(base + '/api/files', { method: 'POST', headers: { cookie }, body: fd });
}

const PNG = Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(100)]);

test('requires login', async () => {
  assert.equal((await fetch(base + '/api/files')).status, 401);
});

test('accepts a real png, lists it, rejects disguised and oversized files', async () => {
  const c = await login('a@test.com');
  assert.equal((await upload(c, 'pic.png', PNG)).status, 201);
  assert.equal((await upload(c, 'evil.png', Buffer.from('MZ\x90\x00 not an image'))).status, 415); // wrong bytes
  assert.equal((await upload(c, 'page.html', Buffer.from('<script>1</script>'))).status, 415); // bad type
  assert.equal((await upload(c, 'big.txt', Buffer.alloc(11 * 1024 * 1024, 'a'))).status, 413); // too large
  const list = await (await fetch(base + '/api/files', { headers: { cookie: c } })).json();
  assert.equal(list.length, 1);
  assert.equal(list[0].name, 'pic.png');
});

test('per-user quota is enforced by the server', async () => {
  const c = await login('q@test.com');
  const nine = Buffer.concat([PNG, Buffer.alloc(9 * 1024 * 1024)]);
  for (let i = 0; i < 5; i++) assert.equal((await upload(c, `f${i}.png`, nine)).status, 201); // ~45 MB
  assert.equal((await upload(c, 'f5.png', nine)).status, 413); // would pass 50 MB
});

test("a user cannot delete or see someone else's file", async () => {
  const a = await login('owner@test.com');
  const b = await login('other@test.com');
  const id = (await (await upload(a, 'mine.png', PNG)).json()).id;
  assert.equal((await fetch(base + '/api/files/' + id, { method: 'DELETE', headers: { cookie: b } })).status, 404);
  assert.equal((await (await fetch(base + '/api/files', { headers: { cookie: b } })).json()).length, 0);
  assert.equal((await fetch(base + '/api/files/' + id, { method: 'DELETE', headers: { cookie: a } })).status, 200);
});

test('a valid cookie for a user that no longer exists is rejected, not crashed on', async () => {
  const c = await login('gone@test.com');
  const db = require('../db');
  db.prepare('DELETE FROM users WHERE email = ?').run('gone@test.com'); // simulates a wiped database
  assert.equal((await fetch(base + '/api/me', { headers: { cookie: c } })).status, 401);
  assert.equal((await upload(c, 'pic.png', PNG)).status, 401);
  assert.equal((await fetch(base + '/api/health')).status, 200); // server still up
});
