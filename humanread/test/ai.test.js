'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const ai = require('../src/ai');

function fakeApi(handler) {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, JSON.parse(body || '{}'), res));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const reply = (res, text) => {
  res.writeHead(200, { 'content-type': 'application/json' });
  res.end(JSON.stringify({ content: [{ type: 'text', text }] }));
};

test('parseJson يتحمل علامات الكود والنص الزائد', () => {
  const r = ai.parseJson('هذا الرد:\n```json\n{"text":"شلونك","speech":"شَلُونِك"}\n```');
  assert.deepEqual(r, { text: 'شلونك', speech: 'شَلُونِك' });
  assert.equal(ai.parseJson('{"text":"هسه"}').speech, null);
  assert.throws(() => ai.parseJson('لا json هنا'));
  assert.throws(() => ai.parseJson('{"text":""}'));
});

test('convertWithAI يرسل الطلب الصحيح ويقرأ الرد', async () => {
  let seen;
  const srv = await fakeApi((req, body, res) => {
    seen = { url: req.url, key: req.headers['x-api-key'], ver: req.headers['anthropic-version'], body };
    reply(res, '{"text":"شتريد هسه؟","speech":"شَتْرِيد هَسَّه؟"}');
  });
  try {
    const out = await ai.convertWithAI('ماذا تريد الآن؟', { apiKey: 'k-test', baseUrl: `http://127.0.0.1:${srv.address().port}` });
    assert.equal(out.text, 'شتريد هسه؟');
    assert.equal(seen.url, '/v1/messages');
    assert.equal(seen.key, 'k-test');
    assert.equal(seen.ver, '2023-06-01');
    assert.equal(seen.body.model, ai.DEFAULT_MODEL);
    assert.match(seen.body.messages[0].content, /ماذا تريد الآن؟/);
    assert.match(seen.body.system, /العراقية/);
  } finally { srv.close(); }
});

test('أخطاء الخدمة تُرمى برسالة واضحة', async () => {
  const srv = await fakeApi((req, body, res) => { res.writeHead(401); res.end('{"error":"bad key"}'); });
  try {
    await assert.rejects(ai.convertWithAI('نص', { apiKey: 'x', baseUrl: `http://127.0.0.1:${srv.address().port}` }), /401/);
  } finally { srv.close(); }
  await assert.rejects(ai.convertWithAI('نص', { apiKey: '' }), /غير مفعّل/);
});

test('الخادم: وضع الذكاء الاصطناعي ثم الرجوع للقاموس عند فشل الخدمة', async () => {
  let fail = false;
  const fake = await fakeApi((req, body, res) => {
    if (fail) { res.writeHead(500); return res.end('boom'); }
    reply(res, '{"text":"شتريد هسه؟","speech":"شَتْرِيد هَسَّه؟"}');
  });
  const prev = { k: process.env.ANTHROPIC_API_KEY, u: process.env.HUMANREAD_AI_URL };
  process.env.ANTHROPIC_API_KEY = 'k-test';
  process.env.HUMANREAD_AI_URL = `http://127.0.0.1:${fake.address().port}`;
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  const post = (body) => fetch(base + '/api/convert', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) }).then((r) => r.json());
  const origErr = console.error;
  console.error = () => {};
  try {
    assert.equal((await (await fetch(base + '/api/dialects')).json()).ai, true);

    const viaAi = await post({ text: 'ماذا تريد الآن؟', dialect: 'iraqi' });
    assert.equal(viaAi.engine, 'ai');
    assert.equal(viaAi.output, 'شتريد هسه؟');
    assert.equal(viaAi.speech, 'شَتْرِيد هَسَّه؟');
    assert.deepEqual(viaAi.tokens.filter((t) => t.type === 'word').map((t) => t.out), ['شتريد', 'هسه']);

    const viaDict = await post({ text: 'ماذا تريد الآن؟', dialect: 'iraqi', mode: 'dictionary' });
    assert.equal(viaDict.engine, 'dictionary');

    fail = true;
    const fallback = await post({ text: 'ماذا تريد؟', dialect: 'iraqi' });
    assert.equal(fallback.engine, 'dictionary');
    assert.equal(fallback.output, 'شتريد؟');
    assert.match(fallback.warning, /القاموس/);
  } finally {
    console.error = origErr;
    server.close();
    fake.close();
    for (const [k, v] of [['ANTHROPIC_API_KEY', prev.k], ['HUMANREAD_AI_URL', prev.u]]) {
      if (v === undefined) delete process.env[k]; else process.env[k] = v;
    }
  }
});
