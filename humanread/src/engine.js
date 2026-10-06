'use strict';
const { getDialect } = require('./dialects');

/* ────────────── تطبيع النص العربي ────────────── */

const MARKS = /[ً-ٰٟۖ-ۭـ]/g; // التشكيل والتطويل
const ARABIC_WORD = /[ء-ٰٟـٮ-ۓۺ-ۿ]+/g;
const SPACES_ONLY = /^[ \t ]+$/;

const stripMarks = (s) => s.replace(MARKS, '');

/** مفتاح المطابقة: بلا تشكيل، وبتوحيد الألف والياء والكاف الفارسية */
const key = (s) =>
  stripMarks(s)
    .replace(/[أإآٱ]/g, 'ا')
    .replace(/ى/g, 'ي')
    .replace(/ک/g, 'ك')
    .replace(/ی/g, 'ي')
    .replace(/[ۀە]/g, 'ه')
    .trim();

/* ────────────── بناء فهرس اللهجة (مرة واحدة) ────────────── */

const indexCache = new Map();

function buildIndex(dialect) {
  const fwd = new Map(); // فصحى → لهجة
  const rev = new Map(); // لهجة → فصحى
  let maxFwd = 1;
  let maxRev = 1;

  const addRev = (dialForm, msaForm) => {
    if (!dialForm || dialForm.endsWith('+')) return;
    const k = key(dialForm);
    if (k && !rev.has(k)) {
      rev.set(k, { out: msaForm, alts: [] });
      maxRev = Math.max(maxRev, k.split(/\s+/).length);
    }
  };

  for (const [msa, val] of dialect.entries) {
    const outs = Array.isArray(val) ? val : [val];
    const k = key(msa);
    if (!fwd.has(k)) {
      fwd.set(k, { out: outs[0], alts: outs.slice(1) });
      maxFwd = Math.max(maxFwd, k.split(/\s+/).length);
    }
    for (const o of outs) addRev(o, msa);
  }
  for (const [dialForm, msaForm] of dialect.reverseOnly || []) addRev(dialForm, msaForm);

  const verbs = new Set((dialect.verbs || []).map(key));
  const pastOf = new Map((dialect.pastOf || []).map(([m, d]) => [key(m), d]));
  return { fwd, rev, maxFwd, maxRev, verbs, pastOf };
}

function getIndex(dialect) {
  if (!indexCache.has(dialect.id)) indexCache.set(dialect.id, buildIndex(dialect));
  return indexCache.get(dialect.id);
}

/* ────────────── تقطيع النص ────────────── */

/** يقسم النص إلى كلمات عربية وفواصل (علامات ترقيم، مسافات، أرقام، لاتيني…) */
function tokenize(text) {
  const tokens = [];
  let last = 0;
  for (const m of text.matchAll(ARABIC_WORD)) {
    if (m.index > last) tokens.push({ type: 'sep', src: text.slice(last, m.index) });
    tokens.push({ type: 'word', src: m[0] });
    last = m.index + m[0].length;
  }
  if (last < text.length) tokens.push({ type: 'sep', src: text.slice(last) });
  return tokens;
}

/* ────────────── السوابق ────────────── */

// الأطول أولًا. تُقبل فقط إذا كان الباقي كلمة معروفة في القاموس.
const PREFIXES = ['وبال', 'وال', 'فال', 'بال', 'ولل', 'لل', 'ال', 'و', 'ف', 'ب', 'ل'];
// كلمات قصيرة مسموح لها بالظهور بعد السابقة (وهو، فهي، ولا …)
const SHORT_OK = new Set(['هو', 'هي', 'انا', 'لا', 'ما', 'لم', 'لن']);

function lookupWord(word, map) {
  const clean = stripMarks(word);
  const k = key(word);
  const direct = map.get(k);
  if (direct) return { entry: direct, prefix: '' };
  for (const p of PREFIXES) {
    if (!k.startsWith(p)) continue;
    const rest = k.slice(p.length);
    if (rest.length < 3 && !SHORT_OK.has(rest)) continue;
    const entry = map.get(rest);
    if (entry && entry.out !== '' && !entry.out.endsWith('+')) {
      return { entry, prefix: clean.slice(0, p.length) };
    }
  }
  return null;
}

/* ────────────── التحويل ────────────── */

/**
 * @param {string} text           النص المُدخل
 * @param {string} dialectId      معرّف اللهجة
 * @param {'toDialect'|'toMsa'} direction  فصحى→لهجة أو لهجة→فصحى
 */
function convert(text, dialectId, direction = 'toDialect') {
  const dialect = getDialect(dialectId);
  if (!dialect) throw new Error(`لهجة غير مدعومة: ${dialectId}`);
  const idx = getIndex(dialect);
  const toDialect = direction !== 'toMsa';
  const map = toDialect ? idx.fwd : idx.rev;
  const maxN = toDialect ? idx.maxFwd : idx.maxRev;

  const src = tokenize(String(text));
  const out = [];
  let i = 0;
  let pending = null; // قاعدة تنتظر الفعل التالي: 'past' | 'future'

  const nextWordKey = (from) => {
    // الكلمة التالية إن فصلتها مسافات فقط
    if (src[from]?.type === 'sep' && SPACES_ONLY.test(src[from].src) && src[from + 1]?.type === 'word') {
      return key(src[from + 1].src);
    }
    if (src[from]?.type === 'word') return key(src[from].src);
    return null;
  };

  while (i < src.length) {
    const tok = src[i];
    if (tok.type === 'sep') {
      out.push({ type: 'sep', src: tok.src, out: tok.src });
      i++;
      continue;
    }

    // 1) عبارات متعددة الكلمات (الأطول أولًا)
    let matched = false;
    for (let n = maxN; n >= 2 && !matched; n--) {
      const words = [];
      let j = i;
      while (j < src.length && words.length < n) {
        if (src[j].type === 'word') words.push(src[j].src);
        else if (!SPACES_ONLY.test(src[j].src)) break;
        j++;
      }
      if (words.length < n) continue;
      const entry = map.get(words.map(key).join(' '));
      if (entry) {
        out.push({
          type: 'word',
          src: words.join(' '),
          out: entry.out,
          alts: entry.alts,
          kind: 'mapped',
          span: n,
        });
        i = j;
        matched = true;
      }
    }
    if (matched) continue;

    // 2) قواعد سياقية (نفي، حذف "أن"، مستقبل) — للتحويل إلى اللهجة فقط
    const k = key(tok.src);
    if (toDialect) {
      const next = nextWordKey(i + 1);
      const nextIsVerb = next !== null && idx.verbs.has(next);
      if (k === 'لا' && nextIsVerb) {
        out.push({ type: 'word', src: tok.src, out: dialect.neg || 'ما', alts: ['لا'], kind: 'rule' });
        i++;
        continue;
      }
      // لم أذهب ← ما رحت
      if (k === 'لم' && nextIsVerb && idx.pastOf.has(next)) {
        out.push({ type: 'word', src: tok.src, out: dialect.neg || 'ما', alts: [], kind: 'rule' });
        pending = 'past';
        i++;
        continue;
      }
      if (k === 'ان' && nextIsVerb) {
        out.push({ type: 'word', src: tok.src, out: '', alts: [], kind: 'dropped' });
        i++;
        continue;
      }
      if ((k === 'سوف' || k === 'لن') && nextIsVerb && dialect.future) {
        const f = dialect.future;
        const neg = k === 'لن';
        let o;
        if (f.word) o = neg ? f.neg || `ما ${f.word}` : f.word;
        else {
          o = neg ? f.neg || 'مش' : '';
          pending = 'future';
        }
        out.push({ type: 'word', src: tok.src, out: o, alts: [], kind: neg || o ? 'rule' : 'dropped' });
        i++;
        continue;
      }
      // سأذهب ← راح أروح / هروح
      if (dialect.future && k.length >= 4 && k[0] === 'س' && idx.verbs.has(k.slice(1))) {
        const hit = map.get(k.slice(1));
        const f = dialect.future;
        let o;
        if (f.word) o = `${f.word} ${hit.out}`;
        else o = f.prefix + (f.stripLeading && hit.out.startsWith(f.stripLeading) ? hit.out.slice(f.stripLeading.length) : hit.out);
        out.push({ type: 'word', src: tok.src, out: o, alts: [], kind: 'rule' });
        i++;
        continue;
      }
    }

    // 3) كلمة مفردة (مع السوابق)
    if (toDialect && pending) {
      const mode = pending;
      pending = null;
      const base = map.get(k);
      if (mode === 'past' && idx.pastOf.has(k)) {
        out.push({ type: 'word', src: tok.src, out: idx.pastOf.get(k), alts: base ? [base.out] : [], kind: 'rule' });
        i++;
        continue;
      }
      if (mode === 'future' && base) {
        const f = dialect.future;
        const o = f.prefix + (f.stripLeading && base.out.startsWith(f.stripLeading) ? base.out.slice(f.stripLeading.length) : base.out);
        out.push({ type: 'word', src: tok.src, out: o, alts: [], kind: 'rule' });
        i++;
        continue;
      }
    }
    const hit = lookupWord(tok.src, map);
    if (hit) {
      out.push({
        type: 'word',
        src: tok.src,
        out: hit.prefix + hit.entry.out,
        alts: hit.entry.alts.map((a) => hit.prefix + a),
        kind: 'mapped',
      });
    } else {
      out.push({ type: 'word', src: tok.src, out: tok.src, alts: [], kind: 'kept' });
    }
    i++;
  }

  // 4) ما بعد المعالجة: حذف الكلمات المسقَطة مع مسافتها، ولصق ما ينتهي بـ "+"
  for (let t = 0; t < out.length; t++) {
    const tk = out[t];
    if (tk.type !== 'word') continue;
    if (tk.out === '') {
      const sp = out[t + 1];
      if (sp && sp.type === 'sep' && SPACES_ONLY.test(sp.out)) sp.out = '';
      if (!sp && out[t - 1]?.type === 'sep' && SPACES_ONLY.test(out[t - 1].out)) out[t - 1].out = '';
      if (!tk.kind || tk.kind === 'mapped') tk.kind = 'dropped';
    } else if (tk.out.endsWith('+')) {
      tk.out = tk.out.slice(0, -1);
      const sp = out[t + 1];
      if (sp && sp.type === 'sep' && SPACES_ONLY.test(sp.out)) sp.out = '';
      tk.attach = true;
    }
  }

  const output = out.map((t) => t.out).join('');
  const words = out.filter((t) => t.type === 'word');
  const total = words.reduce((n, w) => n + (w.span || 1), 0);
  const converted = words
    .filter((w) => w.kind !== 'kept')
    .reduce((n, w) => n + (w.span || 1), 0);

  return {
    dialect: dialect.id,
    direction: toDialect ? 'toDialect' : 'toMsa',
    input: String(text),
    output,
    tokens: out,
    stats: {
      words: total,
      converted,
      kept: total - converted,
      ratio: total ? Math.round((converted / total) * 100) : 0,
    },
  };
}

module.exports = { convert, tokenize, key, stripMarks };
