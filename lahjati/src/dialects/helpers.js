'use strict';

// ترتيب الأشخاص في جداول تصريف الأفعال:
// أنا، أنتَ، أنتِ، هو، هي، نحن، أنتم، هم
const PERSONS = 8;

/**
 * يبني قائمة مدخلات من جدول تصريف فعل (مضارع + ماضٍ) بين الفصحى واللهجة.
 * كل مصفوفة طولها 8 بترتيب الأشخاص أعلاه.
 * @returns {{entries: Array, verbs: string[]}} المدخلات + صيغ المضارع الفصيحة
 */
function verb({ msaPresent, dialPresent, msaPast, dialPast }) {
  const entries = [];
  const present = [];
  const pastOf = []; // [مضارع فصيح، ماضي اللهجة] لتحويل «لم + مضارع»
  const check = (arr, name) => {
    if (arr && arr.length !== PERSONS) {
      throw new Error(`verb(): ${name} يجب أن يحوي ${PERSONS} صيغ، وجدت ${arr.length}`);
    }
  };
  check(msaPresent, 'msaPresent');
  check(dialPresent, 'dialPresent');
  check(msaPast, 'msaPast');
  check(dialPast, 'dialPast');
  if (msaPresent && dialPresent) {
    msaPresent.forEach((m, i) => {
      entries.push([m, dialPresent[i]]);
      present.push(m);
      if (dialPast) pastOf.push([m, dialPast[i]]);
    });
  }
  if (msaPast && dialPast) {
    msaPast.forEach((m, i) => entries.push([m, dialPast[i]]));
  }
  return { entries, verbs: present, pastOf };
}

/** يجمع عدة نتائج verb() في كائن واحد */
function verbs(list) {
  return list.reduce(
    (acc, v) => {
      acc.entries.push(...v.entries);
      acc.verbs.push(...v.verbs);
      acc.pastOf.push(...v.pastOf);
      return acc;
    },
    { entries: [], verbs: [], pastOf: [] }
  );
}

module.exports = { verb, verbs, PERSONS };
