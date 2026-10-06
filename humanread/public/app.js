'use strict';
/* واجهة HumanRead: نص عربي ← عراقي ← قراءة صوتية */

const DIALECT = 'iraqi';
const $ = (id) => document.getElementById(id);
const el = {
  input: $('input'), samples: $('samples'), counter: $('counter'),
  convert: $('convert'), clear: $('clear'), status: $('status'),
  resultCard: $('result-card'), result: $('result'), stats: $('stats'),
  play: $('play'), pause: $('pause'), stop: $('stop'), copy: $('copy'),
  rate: $('rate'), rateOut: $('rate-out'), voice: $('voice'), voiceNote: $('voice-note'),
  dlg: $('word-dialog'), wdSrc: $('wd-src'), wdOut: $('wd-out'), wdAltsWrap: $('wd-alts-wrap'),
  wdAlts: $('wd-alts'), wdSuggest: $('wd-suggest'), wdSend: $('wd-send'), wdMsg: $('wd-msg'),
};

const state = { dialect: null, result: null, voices: [], speaking: false, editing: -1 };

/* ───────────── أدوات ───────────── */

function setStatus(msg, isError = false) {
  el.status.textContent = msg;
  el.status.style.color = isError ? 'var(--danger)' : '';
}

async function api(path, body) {
  const res = await fetch(path, body ? {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  } : undefined);
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error || `خطأ ${res.status}`);
  return data;
}

async function copyText(text, okMsg = 'تم النسخ ✔') {
  try {
    await navigator.clipboard.writeText(text);
    setStatus(okMsg);
  } catch {
    const ta = document.createElement('textarea');
    ta.value = text; document.body.append(ta); ta.select();
    try { document.execCommand('copy'); setStatus(okMsg); } catch { setStatus('تعذّر النسخ', true); }
    ta.remove();
  }
  setTimeout(() => setStatus(''), 2000);
}

const outputText = () => state.result?.tokens.map((t) => t.out).join('') ?? '';

/* ───────────── التحويل والعرض ───────────── */

function updateCounter() {
  el.counter.textContent = `${el.input.value.length} / 5000`;
}

async function doConvert() {
  const text = el.input.value;
  if (!text.trim()) {
    setStatus('اكتب نصًّا أولًا', true);
    el.input.focus();
    return;
  }
  setStatus('جارٍ التحويل…');
  el.convert.disabled = true;
  try {
    stopSpeech();
    state.result = await api('/api/convert', { text, dialect: DIALECT });
    renderResult();
    setStatus('');
  } catch (err) {
    setStatus(err.message, true);
  } finally {
    el.convert.disabled = false;
  }
}

function renderResult() {
  const r = state.result;
  el.resultCard.hidden = false;
  el.result.replaceChildren();
  r.tokens.forEach((t, i) => {
    if (t.type === 'sep') {
      el.result.append(document.createTextNode(t.out));
      return;
    }
    if (t.out === '') return; // كلمة محذوفة في العراقي (مثل «هل»)
    const s = document.createElement('span');
    s.className = `w ${t.kind}`;
    s.dataset.i = String(i);
    s.textContent = t.out;
    if (t.kind === 'mapped' || t.kind === 'rule') {
      s.tabIndex = 0;
      s.setAttribute('role', 'button');
      s.title = `الأصل: ${t.src}`;
    }
    el.result.append(s);
  });
  const { words, converted, ratio } = r.stats;
  el.stats.textContent = `تغيّرت ${converted} من ${words} كلمة (${ratio}%)`;
  refreshVoices();
  updateVoiceNote();
}

function openWord(i) {
  const t = state.result.tokens[i];
  if (!t || t.type !== 'word') return;
  state.editing = i;
  el.wdSrc.textContent = t.src;
  el.wdOut.textContent = t.out;
  el.wdSuggest.value = '';
  el.wdMsg.textContent = '';
  el.wdAlts.replaceChildren();
  const alts = (t.alts || []).filter((a) => a && a !== t.out);
  el.wdAltsWrap.hidden = alts.length === 0;
  for (const a of alts) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = a;
    b.addEventListener('click', () => {
      t.alts = [t.out, ...alts.filter((x) => x !== a)];
      t.out = a;
      renderResult();
      el.dlg.close();
    });
    el.wdAlts.append(b);
  }
  el.dlg.showModal();
}

el.result.addEventListener('click', (e) => {
  const w = e.target.closest('.w.mapped, .w.rule');
  if (w) openWord(Number(w.dataset.i));
});
el.result.addEventListener('keydown', (e) => {
  if (e.key !== 'Enter' && e.key !== ' ') return;
  const w = e.target.closest('.w.mapped, .w.rule');
  if (w) { e.preventDefault(); openWord(Number(w.dataset.i)); }
});

el.wdSend.addEventListener('click', async () => {
  const suggestion = el.wdSuggest.value.trim();
  if (!suggestion) { el.wdMsg.textContent = 'اكتب اقتراحك أولًا'; return; }
  const t = state.result.tokens[state.editing];
  try {
    await api('/api/suggest', { dialect: DIALECT, source: t.src, current: t.out, suggestion });
    el.wdMsg.textContent = 'شكرًا لك! وصلنا اقتراحك.';
    el.wdSuggest.value = '';
  } catch (err) {
    el.wdMsg.textContent = err.message;
  }
});

el.copy.addEventListener('click', () => copyText(outputText()));

function renderSamples() {
  el.samples.replaceChildren();
  for (const s of state.dialect?.samples || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = s.length > 34 ? s.slice(0, 32) + '…' : s;
    b.title = s;
    b.addEventListener('click', () => { el.input.value = s; updateCounter(); doConvert(); });
    el.samples.append(b);
  }
}

/* ───────────── القراءة الصوتية ───────────── */

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;
const normLang = (l) => (l || '').replace('_', '-').toLowerCase();

function refreshVoices() {
  if (!synth) return;
  const all = synth.getVoices().filter((v) => normLang(v.lang).startsWith('ar'));
  state.voices = all;
  const prev = el.voice.value;
  el.voice.replaceChildren(new Option('تلقائي (الأنسب للعراقية)', ''));
  for (const v of all) el.voice.append(new Option(`${v.name} — ${v.lang}`, v.voiceURI));
  if ([...el.voice.options].some((o) => o.value === prev)) el.voice.value = prev;
}

function pickVoice() {
  if (el.voice.value) return state.voices.find((v) => v.voiceURI === el.voice.value) || null;
  for (const lang of state.dialect?.ttsLangs || []) {
    const hit = state.voices.find((v) => normLang(v.lang) === lang.toLowerCase());
    if (hit) return hit;
  }
  return state.voices[0] || null;
}

function updateVoiceNote() {
  const d = state.dialect;
  if (!d) return; // أحداث الأصوات قد تصل قبل تحميل بيانات اللهجة
  if (!synth) {
    el.voiceNote.textContent = 'متصفحك لا يدعم القراءة الصوتية. جرّب Chrome أو Edge أو Safari.';
    el.play.disabled = true;
    return;
  }
  const v = pickVoice();
  const natives = (d.nativeLangs || []).map((l) => l.toLowerCase());
  if (!v) {
    el.voiceNote.textContent = 'لم يُعثر على صوت عربي في جهازك. ثبّت صوتًا عربيًا من إعدادات النظام، أو استخدم متصفح Microsoft Edge.';
  } else if (natives.includes(normLang(v.lang))) {
    el.voiceNote.textContent = `✔ يُقرأ بصوت عراقي أصلي: ${v.name}`;
  } else {
    el.voiceNote.textContent = `يُقرأ بصوت «${v.name}» (${v.lang}) — لا يتوفر صوت عراقي أصلي في جهازك، فالنطق تقريبي. استخدم Edge للحصول على صوت عراقي حقيقي.`;
  }
}

/** يقسم النص إلى جمل قصيرة مع خريطة تربط مواضع الحروف بالكلمات للتظليل */
function buildChunks() {
  const sp = state.dialect?.speech || {};
  const fix = (s) => Array.from(s, (ch) => sp[ch] ?? ch).join('');
  const chunks = [];
  let cur = { text: '', map: [] };
  const flush = () => {
    if (cur.text.trim()) chunks.push(cur);
    cur = { text: '', map: [] };
  };
  state.result.tokens.forEach((t, i) => {
    if (t.type === 'word') {
      if (!t.out) return;
      const text = fix(t.out);
      cur.map.push({ start: cur.text.length, end: cur.text.length + text.length, i });
      cur.text += text;
    } else {
      cur.text += t.out;
      if (/[.!؟?؛\n]/.test(t.out) || (cur.text.length > 160 && /\s/.test(t.out))) flush();
    }
  });
  flush();
  return chunks;
}

function highlight(i) {
  el.result.querySelectorAll('.w.speaking').forEach((n) => n.classList.remove('speaking'));
  if (i == null) return;
  const n = el.result.querySelector(`.w[data-i="${i}"]`);
  if (n) {
    n.classList.add('speaking');
    n.scrollIntoView({ block: 'nearest', behavior: 'smooth' });
  }
}

function setPlayerUi(speaking, paused = false) {
  state.speaking = speaking;
  el.play.disabled = !synth || (speaking && !paused);
  el.pause.disabled = !speaking;
  el.stop.disabled = !speaking;
  el.pause.textContent = paused ? '▶ متابعة' : '⏸ إيقاف مؤقت';
}

function stopSpeech() {
  if (!synth) return;
  speak.session = null;
  synth.cancel();
  highlight(null);
  setPlayerUi(false);
}

function speak() {
  if (!synth || !state.result) return;
  synth.cancel();
  const chunks = buildChunks();
  if (!chunks.length) return;
  const voice = pickVoice();
  const lang = voice?.lang || 'ar-SA';
  const session = Symbol('speech');
  speak.session = session;

  chunks.forEach((c, n) => {
    const u = new SpeechSynthesisUtterance(c.text);
    u.lang = lang;
    if (voice) u.voice = voice;
    u.rate = Number(el.rate.value);
    u.onboundary = (e) => {
      if (speak.session !== session) return;
      const hit = c.map.find((m) => e.charIndex >= m.start && e.charIndex < m.end);
      if (hit) highlight(hit.i);
    };
    u.onend = () => {
      if (speak.session !== session) return;
      if (n === chunks.length - 1) { highlight(null); setPlayerUi(false); }
    };
    u.onerror = (e) => {
      if (speak.session !== session) return;
      if (e.error !== 'canceled' && e.error !== 'interrupted') setStatus('تعذّرت القراءة: ' + e.error, true);
      highlight(null); setPlayerUi(false);
    };
    synth.speak(u);
  });
  setPlayerUi(true);
}

el.play.addEventListener('click', speak);
el.stop.addEventListener('click', stopSpeech);
el.pause.addEventListener('click', () => {
  if (!synth) return;
  if (synth.paused) { synth.resume(); setPlayerUi(true, false); }
  else { synth.pause(); setPlayerUi(true, true); }
});
el.rate.addEventListener('input', () => { el.rateOut.textContent = `${Number(el.rate.value).toFixed(1)}×`; });
el.voice.addEventListener('change', () => { updateVoiceNote(); if (state.speaking) speak(); });
if (synth) synth.addEventListener?.('voiceschanged', () => { refreshVoices(); updateVoiceNote(); });
window.addEventListener('beforeunload', () => synth?.cancel());

/* ───────────── التشغيل ───────────── */

el.convert.addEventListener('click', doConvert);
el.clear.addEventListener('click', () => {
  el.input.value = '';
  updateCounter();
  stopSpeech();
  el.resultCard.hidden = true;
  state.result = null;
  el.input.focus();
});
el.input.addEventListener('input', updateCounter);
el.input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doConvert();
});

(async function init() {
  updateCounter();
  try {
    const { dialects } = await api('/api/dialects');
    state.dialect = dialects.find((d) => d.id === DIALECT);
    renderSamples();
    refreshVoices();
    updateVoiceNote();
  } catch (err) {
    setStatus('تعذّر الاتصال بالخادم: ' + err.message, true);
  }
})();
