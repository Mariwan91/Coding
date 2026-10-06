'use strict';

const iraqi = require('./iraqi');

/** اللهجات المنفّذة — العراقية فقط حاليًا (الهيكل يسمح بإضافة غيرها لاحقًا) */
const implemented = [iraqi];

const byId = new Map(implemented.map((d) => [d.id, d]));

function getDialect(id) {
  return byId.get(id) || null;
}

/** بيانات اللهجات للواجهة (بدون القاموس الثقيل) */
function listDialects() {
  return implemented.map((d) => ({
    id: d.id,
    name: d.name,
    region: d.region,
    status: d.status,
    description: d.description,
    ttsLangs: d.ttsLangs,
    nativeLangs: d.nativeLangs,
    speech: d.speech,
    samples: d.samples,
    entryCount: d.entries.length,
  }));
}

module.exports = { getDialect, listDialects, implemented };
