'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { server } = require('../server');

let base;
test.before(async () => {
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  base = `http://127.0.0.1:${server.address().port}`;
});
test.after(() => server.close());

const post = (path, body) =>
  fetch(base + path, { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) });

test('GET /api/dialects يعيد العراقية جاهزة وبقية اللهجات مخطَّط لها', async () => {
  const { dialects } = await (await fetch(base + '/api/dialects')).json();
  assert.equal(dialects[0].id, 'iraqi');
  assert.equal(dialects[0].status, 'ready');
  assert.ok(dialects.some((d) => d.status === 'planned'));
});

test('POST /api/convert', async () => {
  const res = await post('/api/convert', { text: 'ماذا تريد؟', dialect: 'iraqi' });
  assert.equal(res.status, 200);
  assert.equal((await res.json()).output, 'شتريد؟');
});

test('POST /api/convert يرفض النص الفارغ واللهجة المجهولة والنص الطويل', async () => {
  assert.equal((await post('/api/convert', { text: '  ' })).status, 400);
  assert.equal((await post('/api/convert', { text: 'مرحبا', dialect: 'levantine' })).status, 400);
  assert.equal((await post('/api/convert', { text: 'ا'.repeat(5001) })).status, 413);
});

test('الملفات الثابتة تُخدَّم ومسارات الخروج مرفوضة', async () => {
  const home = await fetch(base + '/');
  assert.equal(home.status, 200);
  assert.match(await home.text(), /HumanRead/);
  const evil = await fetch(base + '/..%2fserver.js');
  assert.notEqual(evil.status, 200);
});
