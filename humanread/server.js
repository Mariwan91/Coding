'use strict';
/**
 * خادم HumanRead — بلا أي اعتماديات خارجية (Node.js فقط).
 *   GET  /api/health      فحص الحالة
 *   GET  /api/dialects    قائمة اللهجات والأمثلة
 *   POST /api/convert     { text, dialect } ← نص عراقي + تفاصيل كل كلمة
 *   GET  /api/voices      أصوات الخادم الاحترافية (إن فُعّلت)
 *   POST /api/speak       { text, voice, speed } ← ملف MP3
 *   POST /api/suggest     { dialect, source, current, suggestion } ← اقتراح تصحيح
 */
const http = require('node:http');
const fs = require('node:fs');
const path = require('node:path');
const crypto = require('node:crypto');
const { convert, tokenize } = require('./src/engine');
const ai = require('./src/ai');
const tts = require('./src/tts');
const { listDialects, getDialect } = require('./src/dialects');

const PORT = Number(process.env.PORT) || 3000;
const HOST = process.env.HOST || '0.0.0.0';
const PUBLIC_DIR = path.join(__dirname, 'public');
const DATA_DIR = path.join(__dirname, 'data');
const MAX_TEXT = 5000;
const MAX_BODY = 32 * 1024;
// إذا ضُبط ACCESS_PASSWORD يصبح الموقع خاصًا: يطلب المتصفح كلمة السر (اسم المستخدم أي شيء)
const ACCESS_PASSWORD = process.env.ACCESS_PASSWORD || '';

const MIME = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.ico': 'image/x-icon',
  '.webmanifest': 'application/manifest+json',
};

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'X-Frame-Options': 'DENY',
  'Referrer-Policy': 'no-referrer',
  'Content-Security-Policy':
    "default-src 'self'; style-src 'self' 'unsafe-inline'; img-src 'self' data:; media-src 'self' blob: data:; frame-ancestors 'none'",
};

function sendJson(res, status, body) {
  const data = JSON.stringify(body);
  res.writeHead(status, {
    ...SECURITY_HEADERS,
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': 'no-store',
    'Content-Length': Buffer.byteLength(data),
  });
  res.end(data);
}

function readJson(req) {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks = [];
    req.on('data', (c) => {
      size += c.length;
      if (size > MAX_BODY) {
        reject(Object.assign(new Error('الطلب كبير جدًا'), { status: 413 }));
        req.destroy();
        return;
      }
      chunks.push(c);
    });
    req.on('end', () => {
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'));
      } catch {
        reject(Object.assign(new Error('JSON غير صالح'), { status: 400 }));
      }
    });
    req.on('error', reject);
  });
}

// حدّ بسيط لعدد الطلبات لكل عنوان IP (في الذاكرة)
const hits = new Map();
function rateLimited(ip, limit, windowMs) {
  const now = Date.now();
  const rec = (hits.get(ip) || []).filter((t) => now - t < windowMs);
  rec.push(now);
  hits.set(ip, rec);
  return rec.length > limit;
}
setInterval(() => {
  const now = Date.now();
  for (const [ip, rec] of hits) {
    if (!rec.some((t) => now - t < 60_000)) hits.delete(ip);
  }
}, 60_000).unref();

async function handleApi(req, res, url) {
  const ip = req.socket.remoteAddress || 'unknown';

  if (req.method === 'GET' && url.pathname === '/api/health') {
    return sendJson(res, 200, { ok: true, name: 'humanread', time: new Date().toISOString() });
  }
  if (req.method === 'GET' && url.pathname === '/api/dialects') {
    return sendJson(res, 200, { dialects: listDialects(), ai: ai.isEnabled() });
  }

  if (req.method === 'GET' && url.pathname === '/api/voices') {
    const voices = tts.isEnabled() ? await tts.listVoices() : [];
    return sendJson(res, 200, { enabled: voices.length > 0, voices });
  }

  if (req.method === 'POST' && url.pathname === '/api/speak') {
    if (rateLimited(ip + ':speak', 20, 60_000)) return sendJson(res, 429, { error: 'طلبات كثيرة، حاول بعد قليل' });
    if (!tts.isEnabled()) return sendJson(res, 503, { error: 'الصوت الاحترافي غير مفعّل على هذا السيرفر' });
    const body = await readJson(req);
    try {
      const out = await tts.synthesize({ text: body.text, voice: body.voice, speed: body.speed });
      res.writeHead(200, {
        ...SECURITY_HEADERS,
        'Content-Type': out.contentType,
        'Content-Length': out.audio.length,
        'Cache-Control': 'no-store',
        'X-Cached': out.cached ? '1' : '0',
      });
      return res.end(out.audio);
    } catch (err) {
      if (err.status) return sendJson(res, err.status, { error: err.message });
      console.error('TTS failed:', err.message);
      return sendJson(res, 502, { error: 'تعذّر توليد الصوت من الخدمة، حاول مجددًا' });
    }
  }

  if (req.method === 'POST' && url.pathname === '/api/convert') {
    if (rateLimited(ip, 120, 60_000)) return sendJson(res, 429, { error: 'طلبات كثيرة، حاول بعد قليل' });
    const body = await readJson(req);
    const text = typeof body.text === 'string' ? body.text : '';
    if (!text.trim()) return sendJson(res, 400, { error: 'اكتب نصًا أولًا' });
    if (text.length > MAX_TEXT) return sendJson(res, 413, { error: `الحد الأقصى ${MAX_TEXT} حرف` });
    const dialect = getDialect(body.dialect || 'iraqi');
    if (!dialect) return sendJson(res, 400, { error: 'هذه اللهجة غير متوفرة بعد' });
    // الذكاء الاصطناعي هو الافتراضي إن كان مفعّلًا (إلا إذا طُلب القاموس صراحةً)، وإن فشل نرجع للقاموس
    if (ai.isEnabled() && body.mode !== 'dictionary') {
      try {
        const r = await ai.convertWithAI(text);
        const tokens = tokenize(r.text).map((t) =>
          t.type === 'sep' ? { ...t, out: t.src } : { ...t, out: t.src, alts: [], kind: 'ai' }
        );
        const words = tokens.filter((t) => t.type === 'word').length;
        return sendJson(res, 200, {
          dialect: dialect.id, direction: 'toDialect', engine: 'ai', input: text,
          output: r.text, speech: r.speech, tokens,
          stats: { words, converted: words, kept: 0, ratio: 100 },
        });
      } catch (err) {
        console.error('AI conversion failed, falling back to dictionary:', err.message);
        const fallback = convert(text, dialect.id, 'toDialect');
        return sendJson(res, 200, { ...fallback, engine: 'dictionary', warning: 'تعذّر الذكاء الاصطناعي، استُخدم القاموس' });
      }
    }
    return sendJson(res, 200, { ...convert(text, dialect.id, 'toDialect'), engine: 'dictionary' });
  }

  if (req.method === 'POST' && url.pathname === '/api/suggest') {
    if (rateLimited(ip + ':suggest', 10, 60_000)) return sendJson(res, 429, { error: 'طلبات كثيرة، حاول بعد قليل' });
    const body = await readJson(req);
    const clip = (v, n) => (typeof v === 'string' ? v.trim().slice(0, n) : '');
    const record = {
      time: new Date().toISOString(),
      dialect: clip(body.dialect, 32),
      direction: body.direction === 'toMsa' ? 'toMsa' : 'toDialect',
      source: clip(body.source, 200),
      current: clip(body.current, 200),
      suggestion: clip(body.suggestion, 200),
    };
    if (!record.source || !record.suggestion) return sendJson(res, 400, { error: 'الكلمة والاقتراح مطلوبان' });
    await fs.promises.mkdir(DATA_DIR, { recursive: true });
    await fs.promises.appendFile(path.join(DATA_DIR, 'suggestions.jsonl'), JSON.stringify(record) + '\n');
    return sendJson(res, 201, { ok: true });
  }

  return sendJson(res, 404, { error: 'غير موجود' });
}

function serveStatic(req, res, url) {
  if (req.method !== 'GET' && req.method !== 'HEAD') {
    res.writeHead(405, { Allow: 'GET, HEAD' });
    return res.end();
  }
  let rel;
  try {
    rel = decodeURIComponent(url.pathname);
  } catch {
    res.writeHead(400);
    return res.end();
  }
  if (rel.endsWith('/')) rel += 'index.html';
  const file = path.normalize(path.join(PUBLIC_DIR, rel));
  if (file !== PUBLIC_DIR && !file.startsWith(PUBLIC_DIR + path.sep)) {
    res.writeHead(403);
    return res.end();
  }
  fs.readFile(file, (err, data) => {
    if (err) {
      res.writeHead(404, { ...SECURITY_HEADERS, 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('404 — الصفحة غير موجودة');
    }
    const ext = path.extname(file).toLowerCase();
    res.writeHead(200, {
      ...SECURITY_HEADERS,
      'Content-Type': MIME[ext] || 'application/octet-stream',
      'Cache-Control': ext === '.html' ? 'no-cache' : 'public, max-age=3600',
      'Content-Length': data.length,
    });
    res.end(req.method === 'HEAD' ? undefined : data);
  });
}

function authorized(req) {
  if (!ACCESS_PASSWORD) return true;
  const h = req.headers.authorization || '';
  if (!h.startsWith('Basic ')) return false;
  const given = Buffer.from(h.slice(6), 'base64').toString('utf8');
  const pass = given.slice(given.indexOf(':') + 1);
  const a = crypto.createHash('sha256').update(pass).digest();
  const b = crypto.createHash('sha256').update(ACCESS_PASSWORD).digest();
  return crypto.timingSafeEqual(a, b);
}

const server = http.createServer(async (req, res) => {
  try {
    if (!authorized(req)) {
      res.writeHead(401, { ...SECURITY_HEADERS, 'WWW-Authenticate': 'Basic realm="HumanRead", charset="UTF-8"', 'Content-Type': 'text/plain; charset=utf-8' });
      return res.end('مطلوب كلمة السر');
    }
    const url = new URL(req.url, 'http://localhost');
    if (url.pathname.startsWith('/api/')) return await handleApi(req, res, url);
    return serveStatic(req, res, url);
  } catch (err) {
    const status = err.status || 500;
    if (status === 500) console.error(err);
    if (!res.headersSent) sendJson(res, status, { error: status === 500 ? 'خطأ داخلي في الخادم' : err.message });
    else res.end();
  }
});

if (require.main === module) {
  server.listen(PORT, HOST, () => {
    console.log(`HumanRead يعمل على: http://localhost:${PORT}`);
  });
}

module.exports = { server };
