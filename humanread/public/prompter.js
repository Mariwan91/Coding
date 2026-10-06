'use strict';
/* شاشة التلقين (Teleprompter): نص كبير يتحرك تلقائيًا ليقرأه صانع المحتوى أمام الكاميرا */
window.Prompter = (function () {
  const $ = (id) => document.getElementById(id);
  const root = $('prompter'), view = $('p-view'), text = $('p-text');
  const playBtn = $('p-play'), speed = $('p-speed'), size = $('p-size'), mirror = $('p-mirror');
  const countEl = $('p-count');
  let raf = 0, last = 0, playing = false, wake = null, countdown = 0, opener = null;

  const prefs = {
    load() { try { return JSON.parse(localStorage.getItem('humanread.prompter')) || {}; } catch { return {}; } },
    save() { try { localStorage.setItem('humanread.prompter', JSON.stringify({ speed: speed.value, size: size.value, mirror: mirror.checked })); } catch { /* غير متاح */ } },
  };

  function applyStyle() {
    text.style.fontSize = `${size.value}px`;
    text.style.transform = mirror.checked ? 'scaleX(-1)' : '';
  }

  function updateActive() {
    const mid = view.getBoundingClientRect().top + view.clientHeight / 2;
    for (const el of text.children) {
      const r = el.getBoundingClientRect();
      el.classList.toggle('active', r.top <= mid && r.bottom >= mid);
    }
  }

  function tick(now) {
    if (!playing) return;
    const dt = Math.min(0.1, (now - last) / 1000);
    last = now;
    view.scrollTop += Number(speed.value) * dt;
    updateActive();
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 2) { pause(); return; }
    raf = requestAnimationFrame(tick);
  }

  async function keepAwake() {
    try { wake = await navigator.wakeLock?.request('screen'); } catch { wake = null; }
  }

  function play() {
    if (playing) return;
    // عدّ تنازلي 3-2-1 قبل البدء حتى يتجهّز المتحدث
    if (view.scrollTop < 5 && !countdown) {
      let n = 3;
      countEl.hidden = false;
      countEl.textContent = n;
      playBtn.textContent = '⏸ إيقاف';
      countdown = setInterval(() => {
        n -= 1;
        if (n <= 0) { clearInterval(countdown); countdown = 0; countEl.hidden = true; start(); }
        else countEl.textContent = n;
      }, 1000);
      return;
    }
    start();
  }

  function start() {
    playing = true;
    playBtn.textContent = '⏸ إيقاف';
    last = performance.now();
    keepAwake();
    raf = requestAnimationFrame(tick);
  }

  function pause() {
    playing = false;
    cancelAnimationFrame(raf);
    if (countdown) { clearInterval(countdown); countdown = 0; countEl.hidden = true; }
    playBtn.textContent = view.scrollTop + view.clientHeight >= view.scrollHeight - 2 ? '↺ من البداية' : '▶ متابعة';
    wake?.release?.().catch(() => {});
    wake = null;
  }

  function toggle() {
    if (view.scrollTop + view.clientHeight >= view.scrollHeight - 2) { view.scrollTop = 0; playBtn.textContent = '▶ ابدأ'; }
    (playing || countdown) ? pause() : play();
  }

  function open(scenes) {
    opener = document.activeElement;
    text.replaceChildren(...scenes.map((s) => { const d = document.createElement('div'); d.className = 'p-scene'; d.textContent = s; return d; }));
    const p = prefs.load();
    if (p.speed) speed.value = p.speed;
    if (p.size) size.value = p.size;
    mirror.checked = !!p.mirror;
    applyStyle();
    root.hidden = false;
    document.body.style.overflow = 'hidden';
    view.scrollTop = 0;
    playBtn.textContent = '▶ ابدأ';
    updateActive();
    playBtn.focus();
  }

  function close() {
    pause();
    root.hidden = true;
    document.body.style.overflow = '';
    opener?.focus?.();
  }

  playBtn.addEventListener('click', toggle);
  $('p-close').addEventListener('click', close);
  view.addEventListener('click', toggle);
  speed.addEventListener('input', prefs.save);
  size.addEventListener('input', () => { applyStyle(); updateActive(); prefs.save(); });
  mirror.addEventListener('change', () => { applyStyle(); prefs.save(); });
  document.addEventListener('keydown', (e) => {
    if (root.hidden) return;
    if (e.key === 'Escape') close();
    else if (e.key === ' ' && e.target === document.body) { e.preventDefault(); toggle(); }
    else if (e.key === 'ArrowUp') { speed.value = Math.min(220, Number(speed.value) + 10); prefs.save(); e.preventDefault(); }
    else if (e.key === 'ArrowDown') { speed.value = Math.max(10, Number(speed.value) - 10); prefs.save(); e.preventDefault(); }
  });
  document.addEventListener('visibilitychange', () => { if (document.hidden && playing) pause(); });

  return { open, close };
})();
