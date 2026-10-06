'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const R = require('../public/reels');

test('تقسيم الجمل إلى مشاهد', () => {
  assert.deepEqual(R.splitScenes('شلونك؟ شتسوي هسه؟\nباچر نشوفك.'), ['شلونك؟', 'شتسوي هسه؟', 'باچر نشوفك.']);
});

test('الجملة الطويلة تُقسَّم دون تجاوز الحد', () => {
  const long = 'هذا نص طويل جدا يحتوي على كلمات كثيرة بدون أي فواصل ولا علامات ترقيم أبدا';
  const scenes = R.splitScenes(long, 6);
  assert.ok(scenes.length >= 2);
  for (const s of scenes) assert.ok(R.countWords(s) <= 6, s);
  assert.equal(scenes.join(' '), long);
});

test('التقسيم عند الفواصل أولًا', () => {
  const scenes = R.splitScenes('أول شي، لازم تفتح الباب، وبعدين تدخل البيت بهدوء وتسكر وراك', 5);
  assert.equal(scenes[0], 'أول شي، لازم تفتح الباب،');
});

test('المدة تقل كلما زادت سرعة القراءة', () => {
  const s = 'ثمان كلمات في هذا المشهد القصير جدا عندي';
  assert.ok(R.sceneSeconds(s, 1.4) < R.sceneSeconds(s, 0.8));
});

test('تلخيص المدة وتسمية الريل المناسب', () => {
  const sum = R.summarize(['كلمة واحدة اثنتان ثلاث'], 1);
  assert.equal(sum.totalWords, 4);
  assert.match(R.fitLabel(12), /15/);
  assert.match(R.fitLabel(28), /30/);
  assert.match(R.fitLabel(200), /أطول/);
});

test('صيغة SRT صحيحة ومتسلسلة', () => {
  const srt = R.toSrt(['مرحبا بكم', 'أهلا'], 1);
  assert.match(srt, /^1\n00:00:00,000 --> 00:00:0\d,\d{3}\nمرحبا بكم\n\n2\n/);
  assert.equal(R.srtTime(3661.5), '01:01:01,500');
});
