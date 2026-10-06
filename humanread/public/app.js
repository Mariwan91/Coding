'use strict';
/* واجهة HumanRead: اختيار اللهجة، التحويل عبر الـ API، العرض التفاعلي، والقراءة الصوتية */

const $ = (id) => document.getElementById(id);
const el = {
  dialects: $('dialects'), dialectDesc: $('dialect-desc'), direction: $('direction'),
  input: $('input'), samples: $('samples'), counter: $('counter'),
  convert: $('convert'), clear: $('clear'), status: $('status'),
  resultCard: $('result-card'), result: $('result'), stats: $('stats'),
  play: $('play'), pause: $('pause'), stop: $('stop'), copy: $('copy'),
  rate: $('rate'), rateOut: $('rate-out'), voice: $('voice'), voiceNote: $('voice-note'),
  historyCard: $('history-card'), history: $('history'), clearHistory: $('clear-history'),
  dlg: $('word-dialog'), wdSrc: $('wd-src'), wdOut: $('wd-out'), wdAltsWrap: $('wd-alts-wrap'),
  reelCard: $('reel-card'), reelPill: $('reel-pill'), scenes: $('scenes'), sceneMax: $('scene-max'),
  sceneMaxOut: $('scene-max-out'), openPrompter: $('open-prompter'), copyScenes: $('copy-scenes'), dlSrt: $('dl-srt'),
  wdAlts: $('wd-alts'), wdSuggest: $('wd-suggest'), wdSend: $('wd-send'), wdMsg: $('wd-msg'),
};

const state = {
  dialects: [],
  dialectId: 'iraqi',
  direction: 'toDialect',
  result: null,      // آخر استجابة من /api/convert
  voices: [],
  speaking: false,
  editing: -1,       // فهرس الكلمة المفتوحة في نافذة التفاصيل
};

const currentDialect = () => state.dialects.find((d) => d.id === state.dialectId);

/* ───────────── أدوات ───────────── */

const store = {
  get(k, fallback) {
    try { return JSON.parse(localStorage.getItem(k)) ?? fallback; } catch { return fallback; }
  },
  set(k, v) {
    try { localStorage.setItem(k, JSON.stringify(v)); } catch { /* التخزين غير متاح */ }
  },
};

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

/* ───────────── اللهجات والاتجاه ───────────── */

function renderDialects() {
  el.dialects.replaceChildren();
  for (const d of state.dialects) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.setAttribute('role', 'radio');
    b.setAttribute('aria-checked', String(d.id === state.dialectId));
    b.textContent = d.name;
    if (d.status === 'planned') {
      b.disabled = true;
      b.title = d.region;
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'قريبًا';
      b.append(tag);
    } else if (d.status === 'beta') {
      const tag = document.createElement('span');
      tag.className = 'tag';
      tag.textContent = 'تجريبي';
      b.append(tag);
    }
    b.addEventListener('click', () => selectDialect(d.id));
    el.dialects.append(b);
  }
  const d = currentDialect();
  el.dialectDesc.textContent = d ? `${d.region} — ${d.description}` : '';
}

function renderDirection() {
  const d = currentDialect();
  const [b1, b2] = el.direction.querySelectorAll('button');
  b1.textContent = `فصحى ← ${d.name}`;
  b2.textContent = `${d.name} ← فصحى`;
  b1.setAttribute('aria-checked', String(state.direction === 'toDialect'));
  b2.setAttribute('aria-checked', String(state.direction === 'toMsa'));
  el.input.placeholder = state.direction === 'toDialect'
    ? 'اكتب أو الصق نصًّا بالعربية الفصحى هنا…'
    : `اكتب أو الصق نصًّا بالعامية (${d.name}) هنا…`;
  renderSamples();
}

function renderSamples() {
  const d = currentDialect();
  const list = state.direction === 'toDialect' ? d.samples : d.reverseSamples;
  el.samples.replaceChildren();
  for (const s of list || []) {
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'chip';
    b.textContent = s.length > 34 ? s.slice(0, 32) + '…' : s;
    b.title = s;
    b.addEventListener('click', () => {
      el.input.value = s;
      updateCounter();
      doConvert();
    });
    el.samples.append(b);
  }
}

function selectDialect(id) {
  if (id === state.dialectId) return;
  state.dialectId = id;
  store.set('humanread.dialect', id);
  stopSpeech();
  renderDialects();
  renderDirection();
  updateVoiceNote();
  if (el.input.value.trim()) doConvert();
}

el.direction.addEventListener('click', (e) => {
  const b = e.target.closest('button[data-dir]');
  if (!b || b.dataset.dir === state.direction) return;
  state.direction = b.dataset.dir;
  stopSpeech();
  renderDirection();
  if (el.input.value.trim()) doConvert();
});

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
    state.result = await api('/api/convert', { text, dialect: state.dialectId, direction: state.direction });
    renderResult();
    pushHistory(state.result);
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
    if (t.out === '') return; // كلمة محذوفة في اللهجة
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
  renderReel();
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
      state.result.output = state.result.tokens.map((x) => x.out).join('');
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
    await api('/api/suggest', {
      dialect: state.dialectId, direction: state.direction,
      source: t.src, current: t.out, suggestion,
    });
    el.wdMsg.textContent = 'شكرًا لك! وصلنا اقتراحك.';
    el.wdSuggest.value = '';
  } catch (err) {
    el.wdMsg.textContent = err.message;
  }
});

el.copy.addEventListener('click', () => copyText(outputText()));

/* ───────────── مشاهد الريل ───────────── */

const outputText = () => state.result?.tokens.map((t) => t.out).join('').replace(/[ \t]{2,}/g, ' ').trim() ?? '';
const sceneList = () => Reels.splitScenes(outputText(), Number(el.sceneMax.value));
const fmtSec = (s) => `${s.toFixed(1)} ث`;

function renderReel() {
  if (!state.result) { el.reelCard.hidden = true; return; }
  const rate = Number(el.rate.value) / 0.9; // 0.9 هي السرعة الافتراضية ≈ كلام طبيعي
  const sum = Reels.summarize(sceneList(), rate);
  el.reelCard.hidden = sum.scenes.length === 0;
  el.reelPill.textContent = `≈ ${Math.round(sum.totalSeconds)} ثانية · ${sum.totalWords} كلمة — ${Reels.fitLabel(sum.totalSeconds)}`;
  el.scenes.replaceChildren();
  for (const sc of sum.scenes) {
    const li = document.createElement('li');
    const t = document.createElement('span');
    t.className = 'sc-text';
    t.textContent = sc.text;
    const sec = document.createElement('span');
    sec.className = 'sc-sec';
    sec.textContent = fmtSec(sc.seconds);
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'btn ghost small';
    b.textContent = 'نسخ';
    b.addEventListener('click', () => copyText(sc.text, 'تم نسخ المشهد ✔'));
    li.append(t, sec, b);
    el.scenes.append(li);
  }
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

el.sceneMax.addEventListener('input', () => { el.sceneMaxOut.textContent = el.sceneMax.value; renderReel(); });
el.copyScenes.addEventListener('click', () => copyText(sceneList().join('\n'), 'تم نسخ كل المشاهد ✔'));
el.openPrompter.addEventListener('click', () => { stopSpeech(); Prompter.open(sceneList()); });
el.dlSrt.addEventListener('click', () => {
  const rate = Number(el.rate.value) / 0.9;
  const blob = new Blob(['\ufeff' + Reels.toSrt(sceneList(), rate)], { type: 'text/plain;charset=utf-8' });
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = 'humanread-captions.srt';
  document.body.append(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});

/* ───────────── السجل ───────────── */

function pushHistory(r) {
  const list = store.get('humanread.history', []).filter((h) => !(h.input === r.input && h.dialect === r.dialect && h.direction === r.direction));
  list.unshift({ dialect: r.dialect, direction: r.direction, input: r.input, output: r.output });
  store.set('humanread.history', list.slice(0, 8));
  renderHistory();
}

function renderHistory() {
  const list = store.get('humanread.history', []);
  el.historyCard.hidden = list.length === 0;
  el.history.replaceChildren();
  for (const h of list) {
    const li = document.createElement('li');
    const b = document.createElement('button');
    b.type = 'button';
    b.textContent = h.input.length > 70 ? h.input.slice(0, 68) + '…' : h.input;
    const sm = document.createElement('small');
    sm.textContent = h.output.length > 70 ? h.output.slice(0, 68) + '…' : h.output;
    b.append(sm);
    b.addEventListener('click', () => {
      state.dialectId = h.dialect;
      state.direction = h.direction;
      el.input.value = h.input;
      updateCounter();
      renderDialects();
      renderDirection();
      doConvert();
    });
    li.append(b);
    el.history.append(li);
  }
}
el.clearHistory.addEventListener('click', () => { store.set('humanread.history', []); renderHistory(); });

/* ───────────── القراءة الصوتية ───────────── */

const synth = 'speechSynthesis' in window ? window.speechSynthesis : null;

const normLang = (l) => (l || '').replace('_', '-').toLowerCase();

function refreshVoices() {
  if (!synth) return;
  const all = synth.getVoices().filter((v) => normLang(v.lang).startsWith('ar'));
  state.voices = all;
  const prev = el.voice.value;
  el.voice.replaceChildren(new Option('تلقائي (الأنسب للهجة)', ''));
  for (const v of all) el.voice.append(new Option(`${v.name} — ${v.lang}`, v.voiceURI));
  if ([...el.voice.options].some((o) => o.value === prev)) el.voice.value = prev;
}

function pickVoice() {
  if (el.voice.value) return state.voices.find((v) => v.voiceURI === el.voice.value) || null;
  const d = currentDialect();
  for (const lang of d.ttsLangs || []) {
    const hit = state.voices.find((v) => normLang(v.lang) === lang.toLowerCase());
    if (hit) return hit;
  }
  return state.voices[0] || null;
}

function updateVoiceNote() {
  const d = currentDialect();
  if (!d) return; // أحداث الأصوات قد تصل قبل تحميل اللهجات
  if (!synth) {
    el.voiceNote.textContent = 'متصفحك لا يدعم القراءة الصوتية. جرّب Chrome أو Edge أو Safari.';
    el.play.disabled = true;
    return;
  }
  const v = pickVoice();
  const natives = (d.nativeLangs || []).map((l) => l.toLowerCase());
  if (!v) {
    el.voiceNote.textContent = 'لم يُعثر على صوت عربي في جهازك. ثبّت صوتًا عربيًا من إعدادات النظام، أو جرّب متصفح Microsoft Edge.';
  } else if (natives.includes(normLang(v.lang))) {
    el.voiceNote.textContent = `✔ يُقرأ بصوت ${d.name} أصلي: ${v.name}`;
  } else {
    el.voiceNote.textContent = `يُقرأ بصوت «${v.name}» (${v.lang}) — لا يتوفر صوت ${d.name} أصلي في جهازك، فالنطق تقريبي. جرّب Edge للحصول على صوت أقرب.`;
  }
}

/** يقسم النص إلى مقاطع قصيرة (جمل) مع خريطة تربط مواضع الحروف بالكلمات للتظليل */
function buildChunks(field) {
  const sp = currentDialect().speech || {};
  const fix = (s) => Array.from(s, (ch) => sp[ch] ?? ch).join('');
  const chunks = [];
  let cur = { text: '', map: [] };
  const flush = () => {
    if (cur.text.trim()) chunks.push(cur);
    cur = { text: '', map: [] };
  };
  state.result.tokens.forEach((t, i) => {
    const raw = t[field] ?? t.out;
    if (t.type === 'word') {
      if (!raw) return;
      const text = fix(raw);
      cur.map.push({ start: cur.text.length, end: cur.text.length + text.length, i });
      cur.text += text;
    } else {
      cur.text += raw;
      if (/[.!؟?؛\n]/.test(raw) || (cur.text.length > 160 && /\s/.test(raw))) flush();
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
  el.play.disabled = speaking && !paused ? true : !synth;
  el.pause.disabled = !speaking;
  el.stop.disabled = !speaking;
  el.pause.textContent = paused ? '▶ متابعة' : '⏸ إيقاف مؤقت';
  el.play.textContent = '▶ استمع';
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
  const field = document.querySelector('input[name="readwhat"]:checked').value;
  const chunks = buildChunks(field);
  if (!chunks.length) return;
  const voice = pickVoice();
  const d = currentDialect();
  const lang = voice?.lang || d.ttsLangs?.find((l) => l.includes('-')) || 'ar-SA';
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
    u.onstart = () => { if (speak.session === session && n === 0) setPlayerUi(true); };
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
el.rate.addEventListener('input', () => { el.rateOut.textContent = `${Number(el.rate.value).toFixed(1)}×`; renderReel(); });
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
  el.reelCard.hidden = true;
  state.result = null;
  el.input.focus();
});
el.input.addEventListener('input', updateCounter);
el.input.addEventListener('keydown', (e) => {
  if ((e.ctrlKey || e.metaKey) && e.key === 'Enter') doConvert();
});

(async function init() {
  updateCounter();
  renderHistory();
  try {
    const { dialects } = await api('/api/dialects');
    state.dialects = dialects;
    const saved = store.get('humanread.dialect', 'iraqi');
    if (dialects.some((d) => d.id === saved && d.status !== 'planned')) state.dialectId = saved;
    renderDialects();
    renderDirection();
    refreshVoices();
    updateVoiceNote();
  } catch (err) {
    setStatus('تعذّر الاتصال بالخادم: ' + err.message, true);
  }
})();
