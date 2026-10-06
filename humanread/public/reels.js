'use strict';
/**
 * أدوات صنّاع الريلز: تقسيم النص إلى مشاهد/أسطر قصيرة، تقدير المدة، وتصدير ترجمة SRT.
 * ملف واحد يعمل في المتصفح (window.Reels) وفي Node (require) للاختبار.
 */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.Reels = factory();
})(typeof self !== 'undefined' ? self : this, function () {
  // سرعة الكلام التقريبية بالعربية عند السرعة 1.0 (كلمة/ثانية)
  const WORDS_PER_SEC = 2.4;
  const PAUSE_PER_SCENE = 0.25; // فاصل قصير بين المشاهد

  const countWords = (s) => (s.trim() ? s.trim().split(/\s+/).length : 0);

  /** يقسم جملة طويلة إلى أجزاء متقاربة الطول لا تتجاوز max كلمة */
  function chunkEvenly(words, max) {
    const parts = Math.ceil(words.length / max);
    const size = Math.ceil(words.length / parts);
    const out = [];
    for (let i = 0; i < words.length; i += size) out.push(words.slice(i, i + size).join(' '));
    return out;
  }

  /**
   * @param {string} text      النص النهائي
   * @param {number} maxWords  أقصى عدد كلمات في المشهد الواحد (مناسب لنص يظهر على الشاشة)
   * @returns {string[]}
   */
  function splitScenes(text, maxWords = 8) {
    const max = Math.max(3, Math.floor(maxWords));
    const scenes = [];
    // 1) الجمل: عند . ! ؟ ? أو سطر جديد (مع إبقاء علامة الترقيم في آخر الجملة)
    const sentences = String(text)
      .split(/(?<=[.!؟?])\s+|\n+/)
      .map((s) => s.trim())
      .filter(Boolean);
    for (const sentence of sentences) {
      if (countWords(sentence) <= max) {
        scenes.push(sentence);
        continue;
      }
      // 2) الجملة الطويلة: نقسمها عند الفواصل أولًا
      const clauses = sentence.split(/(?<=[،,؛;:])\s+/).filter(Boolean);
      let buffer = [];
      const flush = () => {
        if (buffer.length) scenes.push(buffer.join(' '));
        buffer = [];
      };
      for (const clause of clauses) {
        const words = clause.split(/\s+/);
        if (words.length > max) {
          flush();
          scenes.push(...chunkEvenly(words, max));
        } else if (countWords(buffer.join(' ')) + words.length > max) {
          flush();
          buffer.push(clause);
        } else {
          buffer.push(clause);
        }
      }
      flush();
    }
    return scenes;
  }

  /** مدة المشهد بالثواني (تقديرية) حسب سرعة القراءة */
  function sceneSeconds(scene, rate = 1) {
    const words = countWords(scene);
    return words / (WORDS_PER_SEC * Math.max(0.3, rate)) + PAUSE_PER_SCENE;
  }

  function summarize(scenes, rate = 1) {
    const timed = scenes.map((text) => ({ text, words: countWords(text), seconds: sceneSeconds(text, rate) }));
    const total = timed.reduce((n, s) => n + s.seconds, 0);
    return { scenes: timed, totalSeconds: total, totalWords: timed.reduce((n, s) => n + s.words, 0) };
  }

  /** أقرب مدة ريل شائعة تتسع للنص */
  function fitLabel(totalSeconds) {
    for (const limit of [15, 30, 60, 90]) {
      if (totalSeconds <= limit) return `يناسب ريل ${limit} ثانية`;
    }
    return 'أطول من 90 ثانية — فكّر بتقسيمه إلى جزأين';
  }

  const pad = (n, w = 2) => String(n).padStart(w, '0');
  function srtTime(sec) {
    const ms = Math.round(sec * 1000);
    const h = Math.floor(ms / 3600000);
    const m = Math.floor((ms % 3600000) / 60000);
    const s = Math.floor((ms % 60000) / 1000);
    return `${pad(h)}:${pad(m)}:${pad(s)},${pad(ms % 1000, 3)}`;
  }

  /** ملف ترجمة SRT جاهز للاستيراد في CapCut/InShot وغيرهما */
  function toSrt(scenes, rate = 1) {
    let t = 0;
    return scenes
      .map((text, i) => {
        const dur = sceneSeconds(text, rate) - PAUSE_PER_SCENE;
        const block = `${i + 1}\n${srtTime(t)} --> ${srtTime(t + dur)}\n${text}\n`;
        t += dur + PAUSE_PER_SCENE;
        return block;
      })
      .join('\n');
  }

  return { splitScenes, sceneSeconds, summarize, fitLabel, toSrt, countWords, srtTime };
});
