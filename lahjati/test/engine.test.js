'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { convert } = require('../src/engine');
const { implemented } = require('../src/dialects');

const iq = (t, dir) => convert(t, 'iraqi', dir).output;

test('أدوات الاستفهام العراقية', () => {
  assert.equal(iq('ماذا تريد'), 'شتريد');
  assert.equal(iq('لماذا'), 'ليش');
  assert.equal(iq('أين البيت'), 'وين البيت');
  assert.equal(iq('كيف حالك؟'), 'شلونك؟');
});

test('حرف الاستفهام «هل» يُحذف دون ترك مسافات زائدة', () => {
  assert.equal(iq('هل تريد شاي'), 'تريد چاي');
});

test('الحروف العراقية الخاصة (گ، چ)', () => {
  assert.equal(iq('قال صديقي'), 'گال صديگي');
  assert.equal(iq('شاي'), 'چاي');
});

test('النفي: لا + مضارع ← ما، ولم + مضارع ← ما + ماضٍ', () => {
  assert.equal(iq('لا أذهب'), 'ما أروح');
  assert.equal(iq('لم أذهب'), 'ما رحت');
  assert.equal(iq('لن أذهب'), 'ما راح أروح');
});

test('المستقبل: سأذهب / سوف أذهب', () => {
  assert.equal(iq('سأذهب'), 'راح أروح');
  assert.equal(iq('سوف أذهب'), 'راح أروح');
});

test('حذف «أن» قبل الفعل المضارع', () => {
  assert.equal(iq('أريد أن أذهب'), 'أريد أروح');
});

test('«في» تلتصق بالكلمة التالية', () => {
  assert.equal(iq('في البيت'), 'بالبيت');
});

test('السوابق: و + كلمة، ال + كلمة', () => {
  assert.equal(iq('والجميل'), 'والحلو');
  assert.equal(iq('الجميلة'), 'الحلوة');
});

test('«فهم» (فعل) لا تُفكَّك إلى ف + هم', () => {
  assert.equal(iq('فهم'), 'فهم');
});

test('الكلمات المجهولة تبقى كما هي', () => {
  assert.equal(iq('الحاسوب'), 'الحاسوب');
  const r = convert('الحاسوب سريع جدا', 'iraqi');
  assert.equal(r.stats.words, 3);
  assert.equal(r.stats.converted, 1);
});

test('الحفاظ على علامات الترقيم والأسطر والأرقام', () => {
  assert.equal(iq('نعم، لدي 3 أطفال.\nشكرا'), 'إي، عندي 3 جهّال.\nمشكور');
});

test('التحويل العكسي: عراقي ← فصحى', () => {
  assert.equal(iq('شلونك؟', 'toMsa'), 'كيف حالك؟');
  assert.equal(iq('ماكو مي', 'toMsa'), 'لا يوجد ماء');
  assert.equal(iq('آني رايح للسوگ', 'toMsa'), 'أنا ذاهب للسوق');
  assert.equal(iq('گال هسه', 'toMsa'), 'قال الآن');
});

test('الاستجابة تحوي تفاصيل كل كلمة', () => {
  const r = convert('هذا جميل', 'iraqi');
  const words = r.tokens.filter((t) => t.type === 'word');
  assert.deepEqual(words.map((w) => [w.src, w.out, w.kind]), [
    ['هذا', 'هاذا', 'mapped'],
    ['جميل', 'حلو', 'mapped'],
  ]);
});

test('اللهجة المصرية: المستقبل والنفي', () => {
  assert.equal(convert('سأذهب غدا', 'egyptian').output, 'هروح بكرة');
  assert.equal(convert('لن أذهب', 'egyptian').output, 'مش هروح');
  assert.equal(convert('لا يوجد ماء', 'egyptian').output, 'مفيش ماء');
});

test('لهجة غير معروفة ترمي خطأ واضحًا', () => {
  assert.throws(() => convert('مرحبا', 'klingon'), /غير مدعومة/);
});

test('سلامة القواميس: لا مدخلات فارغة أو أطوال تصريف خاطئة', () => {
  for (const d of implemented) {
    assert.ok(d.entries.length > 50, `${d.id}: القاموس صغير`);
    for (const [msa, dial] of d.entries) {
      assert.ok(typeof msa === 'string' && msa.trim(), `${d.id}: مفتاح فارغ`);
      assert.ok(typeof dial === 'string' || Array.isArray(dial), `${d.id}: قيمة غير صالحة لـ ${msa}`);
    }
    for (const s of [...d.samples, ...d.reverseSamples]) {
      assert.ok(convert(s, d.id).output.length > 0);
    }
  }
});
