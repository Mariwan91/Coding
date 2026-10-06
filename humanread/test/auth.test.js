'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { spawn } = require('node:child_process');
const path = require('node:path');

const PORT = 3999;
let child;

test.before(async () => {
  child = spawn(process.execPath, [path.join(__dirname, '..', 'server.js')], {
    env: { ...process.env, PORT: String(PORT), HOST: '127.0.0.1', ACCESS_PASSWORD: 'سر-تجريبي' },
    stdio: 'ignore',
  });
  for (let i = 0; i < 40; i++) {
    try { await fetch(`http://127.0.0.1:${PORT}/`); return; } catch { await new Promise((r) => setTimeout(r, 100)); }
  }
  throw new Error('الخادم لم يبدأ');
});
test.after(() => child.kill());

const basic = (pass) => 'Basic ' + Buffer.from('user:' + pass, 'utf8').toString('base64');

test('بدون كلمة سر ← 401', async () => {
  const res = await fetch(`http://127.0.0.1:${PORT}/`);
  assert.equal(res.status, 401);
  assert.match(res.headers.get('www-authenticate'), /Basic/);
  assert.equal((await fetch(`http://127.0.0.1:${PORT}/api/dialects`)).status, 401);
});

test('كلمة سر خاطئة ← 401، وصحيحة ← 200', async () => {
  const bad = await fetch(`http://127.0.0.1:${PORT}/`, { headers: { Authorization: basic('خطأ') } });
  assert.equal(bad.status, 401);
  const ok = await fetch(`http://127.0.0.1:${PORT}/`, { headers: { Authorization: basic('سر-تجريبي') } });
  assert.equal(ok.status, 200);
});
