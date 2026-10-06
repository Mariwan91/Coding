'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const tts = require('../src/tts');

const FAKE_MP3 = Buffer.from([0xff, 0xfb, 0x90, 0x00, 1, 2, 3, 4]);

function fake(handler) {
  const srv = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => (body += c));
    req.on('end', () => handler(req, body, res));
  });
  return new Promise((r) => srv.listen(0, '127.0.0.1', () => r(srv)));
}
const url = (s) => `http://127.0.0.1:${s.address().port}`;

test.beforeEach(() => tts._resetCache());

test('بدون مفاتيح لا يوجد مزوّد', () => {
  assert.equal(tts.isEnabled({}), false);
  assert.equal(tts.isEnabled({ AZURE_SPEECH_KEY: 'k' }), false); // المنطقة مطلوبة
  assert.equal(tts.isEnabled({ ELEVENLABS_API_KEY: 'k' }), true);
});

test('ElevenLabs: قائمة الأصوات وتوليد MP3 بالطلب الصحيح', async () => {
  const seen = [];
  const srv = await fake((req, body, res) => {
    seen.push({ method: req.method, url: req.url, key: req.headers['xi-api-key'], body });
    if (req.url.startsWith('/v1/voices')) {
      res.writeHead(200, { 'content-type': 'application/json' });
      return res.end(JSON.stringify({ voices: [{ voice_id: 'v1', name: 'سامي', labels: { accent: 'iraqi' } }, { voice_id: 'v2', name: 'ليلى' }] }));
    }
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.end(FAKE_MP3);
  });
  const env = { ELEVENLABS_API_KEY: 'el-key', ELEVENLABS_BASE_URL: url(srv), ELEVENLABS_VOICE_ID: 'v2' };
  try {
    const voices = await tts.listVoices(env);
    assert.deepEqual(voices.map((v) => v.id), ['elevenlabs:v2', 'elevenlabs:v1']); // الصوت المضبوط أولًا
    assert.match(voices[1].name, /iraqi/);

    const out = await tts.synthesize({ text: 'شلونك؟', voice: 'elevenlabs:v1', speed: 0.9 }, env);
    assert.deepEqual(out.audio, FAKE_MP3);
    const call = seen.find((s) => s.url.startsWith('/v1/text-to-speech/v1'));
    assert.equal(call.method, 'POST');
    assert.equal(call.key, 'el-key');
    const body = JSON.parse(call.body);
    assert.equal(body.text, 'شلونك؟');
    assert.equal(body.model_id, 'eleven_multilingual_v2');
    assert.equal(body.voice_settings.speed, 0.9);
  } finally { srv.close(); }
});

test('Azure: SSML عراقي مع هروب الرموز وتحويل السرعة', async () => {
  let seen;
  const srv = await fake((req, body, res) => {
    seen = { url: req.url, key: req.headers['ocp-apim-subscription-key'], ct: req.headers['content-type'], fmt: req.headers['x-microsoft-outputformat'], body };
    res.writeHead(200, { 'content-type': 'audio/mpeg' });
    res.end(FAKE_MP3);
  });
  const env = { AZURE_SPEECH_KEY: 'az-key', AZURE_SPEECH_REGION: 'x', AZURE_TTS_BASE_URL: url(srv) };
  try {
    const voices = await tts.listVoices(env);
    assert.deepEqual(voices.map((v) => v.id), ['azure:ar-IQ-RanaNeural', 'azure:ar-IQ-BasselNeural']);
    await tts.synthesize({ text: 'أنا <مو> & زين', voice: 'azure:ar-IQ-BasselNeural', speed: 1.2 }, env);
    assert.equal(seen.url, '/cognitiveservices/v1');
    assert.equal(seen.key, 'az-key');
    assert.equal(seen.ct, 'application/ssml+xml');
    assert.match(seen.fmt, /mp3/);
    assert.match(seen.body, /xml:lang="ar-IQ"/);
    assert.match(seen.body, /voice name="ar-IQ-BasselNeural"/);
    assert.match(seen.body, /rate="\+20%"/);
    assert.match(seen.body, /أنا &lt;مو&gt; &amp; زين/);
  } finally { srv.close(); }
});

test('نفس الطلب مرتين لا يُحاسَب مرتين (ذاكرة مؤقتة)', async () => {
  let calls = 0;
  const srv = await fake((req, body, res) => { calls++; res.writeHead(200); res.end(FAKE_MP3); });
  const env = { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'x', AZURE_TTS_BASE_URL: url(srv) };
  try {
    const a = await tts.synthesize({ text: 'هسه', voice: 'azure:ar-IQ-RanaNeural' }, env);
    const b = await tts.synthesize({ text: 'هسه', voice: 'azure:ar-IQ-RanaNeural' }, env);
    assert.equal(a.cached, false);
    assert.equal(b.cached, true);
    assert.equal(calls, 1);
  } finally { srv.close(); }
});

test('أخطاء: نص فارغ/طويل، ومزوّد يرفض', async () => {
  const srv = await fake((req, body, res) => { res.writeHead(401); res.end('bad key'); });
  const env = { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'x', AZURE_TTS_BASE_URL: url(srv) };
  try {
    await assert.rejects(tts.synthesize({ text: '  ' }, env), (e) => e.status === 400);
    await assert.rejects(tts.synthesize({ text: 'ا'.repeat(5001) }, env), (e) => e.status === 413);
    await assert.rejects(tts.synthesize({ text: 'نص' }, env), /Azure 401/);
    await assert.rejects(tts.synthesize({ text: 'نص' }, {}), (e) => e.status === 503);
  } finally { srv.close(); }
});

test('الخادم: /api/voices و /api/speak', async () => {
  const srv = await fake((req, body, res) => { res.writeHead(200, { 'content-type': 'audio/mpeg' }); res.end(FAKE_MP3); });
  const prev = { ...process.env };
  Object.assign(process.env, { AZURE_SPEECH_KEY: 'k', AZURE_SPEECH_REGION: 'x', AZURE_TTS_BASE_URL: url(srv) });
  const { server } = require('../server');
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const v = await (await fetch(base + '/api/voices')).json();
    assert.equal(v.enabled, true);
    assert.equal(v.voices.length, 2);

    const ok = await fetch(base + '/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: 'شلونك', voice: v.voices[0].id }) });
    assert.equal(ok.status, 200);
    assert.equal(ok.headers.get('content-type'), 'audio/mpeg');
    assert.deepEqual(Buffer.from(await ok.arrayBuffer()), FAKE_MP3);

    const empty = await fetch(base + '/api/speak', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ text: '' }) });
    assert.equal(empty.status, 400);
  } finally {
    server.close(); srv.close();
    for (const k of ['AZURE_SPEECH_KEY', 'AZURE_SPEECH_REGION', 'AZURE_TTS_BASE_URL']) { if (prev[k] === undefined) delete process.env[k]; else process.env[k] = prev[k]; }
    tts._resetCache();
  }
});
