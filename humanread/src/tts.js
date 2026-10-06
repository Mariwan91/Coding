'use strict';
/**
 * توليد الصوت على الخادم (مثل ElevenLabs): نص ← ملف MP3.
 * المزوّدون (يُفعَّل كل واحد عند وجود مفتاحه):
 *   - ElevenLabs : ELEVENLABS_API_KEY  (+ ELEVENLABS_VOICE_ID اختياري، ELEVENLABS_MODEL اختياري)
 *   - Azure Speech: AZURE_SPEECH_KEY + AZURE_SPEECH_REGION  (أصوات عراقية ar-IQ حقيقية)
 * معرّف الصوت: "elevenlabs:<id>" أو "azure:<name>".
 */
const crypto = require('node:crypto');

const AZURE_VOICES = [
  { id: 'azure:ar-IQ-RanaNeural', name: 'رنا — عراقية (أنثى)', provider: 'azure', lang: 'ar-IQ' },
  { id: 'azure:ar-IQ-BasselNeural', name: 'باسل — عراقي (ذكر)', provider: 'azure', lang: 'ar-IQ' },
];
const ELEVEN_DEFAULT_MODEL = 'eleven_multilingual_v2';
const MAX_CHARS = 5000;

const cfg = (env = process.env) => ({
  elKey: env.ELEVENLABS_API_KEY || '',
  elBase: (env.ELEVENLABS_BASE_URL || 'https://api.elevenlabs.io').replace(/\/$/, ''),
  elVoice: env.ELEVENLABS_VOICE_ID || '',
  elModel: env.ELEVENLABS_MODEL || ELEVEN_DEFAULT_MODEL,
  azKey: env.AZURE_SPEECH_KEY || '',
  azRegion: env.AZURE_SPEECH_REGION || '',
  azBase: env.AZURE_TTS_BASE_URL || '',
});

const azureUrl = (c) => (c.azBase || `https://${c.azRegion}.tts.speech.microsoft.com`).replace(/\/$/, '') + '/cognitiveservices/v1';
const isEnabled = (env = process.env) => {
  const c = cfg(env);
  return Boolean(c.elKey || (c.azKey && (c.azRegion || c.azBase)));
};

/* ───────────── قائمة الأصوات ───────────── */

let voiceCache = { at: 0, key: '', voices: [] };

async function listVoices(env = process.env) {
  const c = cfg(env);
  const cacheKey = JSON.stringify([c.elKey, c.elBase, c.elVoice, c.azKey]);
  if (voiceCache.key === cacheKey && Date.now() - voiceCache.at < 10 * 60_000) return voiceCache.voices;

  const voices = [];
  if (c.azKey && (c.azRegion || c.azBase)) voices.push(...AZURE_VOICES);
  if (c.elKey) {
    try {
      const res = await fetch(`${c.elBase}/v1/voices`, { headers: { 'xi-api-key': c.elKey }, signal: AbortSignal.timeout(15_000) });
      if (!res.ok) throw new Error(String(res.status));
      const data = await res.json();
      const el = (data.voices || []).map((v) => ({
        id: `elevenlabs:${v.voice_id}`,
        name: `${v.name}${v.labels?.accent ? ` — ${v.labels.accent}` : ''}`,
        provider: 'elevenlabs',
        lang: 'multi',
      }));
      // الصوت المختار في الإعدادات يظهر أولًا
      el.sort((a, b) => Number(b.id.endsWith(c.elVoice) && !!c.elVoice) - Number(a.id.endsWith(c.elVoice) && !!c.elVoice));
      voices.push(...el);
    } catch (err) {
      console.error('تعذّر جلب أصوات ElevenLabs:', err.message);
      if (c.elVoice) voices.push({ id: `elevenlabs:${c.elVoice}`, name: 'ElevenLabs (الصوت المضبوط)', provider: 'elevenlabs', lang: 'multi' });
    }
  }
  voiceCache = { at: Date.now(), key: cacheKey, voices };
  return voices;
}

/* ───────────── التوليد ───────────── */

const escapeXml = (s) => s.replace(/[<>&'"]/g, (ch) => ({ '<': '&lt;', '>': '&gt;', '&': '&amp;', "'": '&apos;', '"': '&quot;' }[ch]));

async function viaElevenLabs(c, voiceId, text, speed) {
  const res = await fetch(`${c.elBase}/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
    method: 'POST',
    headers: { 'xi-api-key': c.elKey, 'content-type': 'application/json', accept: 'audio/mpeg' },
    body: JSON.stringify({
      text,
      model_id: c.elModel,
      voice_settings: { stability: 0.5, similarity_boost: 0.75, speed: Math.min(1.2, Math.max(0.7, speed)) },
    }),
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`ElevenLabs ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

async function viaAzure(c, voiceName, text, speed) {
  const pct = Math.round((Math.min(1.5, Math.max(0.5, speed)) - 1) * 100);
  const ssml =
    `<speak version="1.0" xmlns="http://www.w3.org/2001/10/synthesis" xml:lang="ar-IQ">` +
    `<voice name="${escapeXml(voiceName)}"><prosody rate="${pct >= 0 ? '+' : ''}${pct}%">${escapeXml(text)}</prosody></voice></speak>`;
  const res = await fetch(azureUrl(c), {
    method: 'POST',
    headers: {
      'Ocp-Apim-Subscription-Key': c.azKey,
      'Content-Type': 'application/ssml+xml',
      'X-Microsoft-OutputFormat': 'audio-24khz-96kbitrate-mono-mp3',
      'User-Agent': 'HumanRead',
    },
    body: ssml,
    signal: AbortSignal.timeout(90_000),
  });
  if (!res.ok) throw new Error(`Azure ${res.status} ${(await res.text().catch(() => '')).slice(0, 200)}`);
  return Buffer.from(await res.arrayBuffer());
}

// ذاكرة مؤقتة صغيرة: نفس النص والصوت والسرعة لا يُحاسَب مرتين
const cache = new Map();
const CACHE_MAX_BYTES = 40 * 1024 * 1024;
let cacheBytes = 0;
function remember(k, buf) {
  if (buf.length > CACHE_MAX_BYTES / 4) return;
  cache.set(k, buf);
  cacheBytes += buf.length;
  while (cacheBytes > CACHE_MAX_BYTES) {
    const [oldK, oldV] = cache.entries().next().value;
    cache.delete(oldK);
    cacheBytes -= oldV.length;
  }
}

/**
 * @returns {Promise<{audio: Buffer, contentType: string, cached: boolean}>}
 */
async function synthesize({ text, voice, speed = 1 }, env = process.env) {
  const c = cfg(env);
  const t = String(text || '').trim();
  if (!t) throw Object.assign(new Error('لا يوجد نص للقراءة'), { status: 400 });
  if (t.length > MAX_CHARS) throw Object.assign(new Error(`الحد الأقصى ${MAX_CHARS} حرف`), { status: 413 });
  const voices = await listVoices(env);
  const chosen = voices.find((v) => v.id === voice) || voices[0];
  if (!chosen) throw Object.assign(new Error('لا يوجد مزوّد صوت مفعّل'), { status: 503 });
  const sp = Number(speed) || 1;
  const k = crypto.createHash('sha256').update([chosen.id, sp, c.elModel, t].join('\n')).digest('hex');
  if (cache.has(k)) return { audio: cache.get(k), contentType: 'audio/mpeg', cached: true };

  const idx = chosen.id.indexOf(':');
  const name = chosen.id.slice(idx + 1);
  const audio = chosen.provider === 'azure' ? await viaAzure(c, name, t, sp) : await viaElevenLabs(c, name, t, sp);
  remember(k, audio);
  return { audio, contentType: 'audio/mpeg', cached: false };
}

module.exports = { listVoices, synthesize, isEnabled, escapeXml, MAX_CHARS, _resetCache: () => { cache.clear(); cacheBytes = 0; voiceCache = { at: 0, key: '', voices: [] }; } };
