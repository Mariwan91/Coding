'use strict';

const iraqi = require('./iraqi');
const egyptian = require('./egyptian');
const gulf = require('./gulf');

/** اللهجات المنفّذة فعليًا */
const implemented = [iraqi, gulf, egyptian];

/** اللهجات المخطَّط لها — تظهر في الواجهة كـ "قريبًا" */
const planned = [
  { id: 'levantine', name: 'الشامية', region: 'سوريا · لبنان · فلسطين · الأردن', status: 'planned' },
  { id: 'maghrebi', name: 'المغاربية', region: 'المغرب · الجزائر · تونس · ليبيا', status: 'planned' },
  { id: 'sudanese', name: 'السودانية', region: 'السودان', status: 'planned' },
  { id: 'yemeni', name: 'اليمنية', region: 'اليمن', status: 'planned' },
];

const byId = new Map(implemented.map((d) => [d.id, d]));

function getDialect(id) {
  return byId.get(id) || null;
}

/** بيانات اللهجات للواجهة (بدون القاموس الثقيل) */
function listDialects() {
  const ready = implemented.map((d) => ({
    id: d.id,
    name: d.name,
    nameEn: d.nameEn,
    region: d.region,
    status: d.status,
    description: d.description,
    ttsLangs: d.ttsLangs,
    nativeLangs: d.nativeLangs,
    speech: d.speech,
    samples: d.samples,
    reverseSamples: d.reverseSamples,
    entryCount: d.entries.length,
  }));
  return [...ready, ...planned];
}

module.exports = { getDialect, listDialects, implemented };
