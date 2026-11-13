// Run with: node --test tests/
const test = require('node:test');
const assert = require('node:assert/strict');
const Lib = require('../lib.js');

const psiItem = {
  timestamp: '2026-11-12T21:00:00+08:00',
  updatedTimestamp: '2026-11-12T21:01:00+08:00',
  readings: { psi_twenty_four_hourly: { north: 61, south: 59, west: 62, east: 57, central: 62 } },
};
const pmItem = {
  timestamp: '2026-11-13T00:00:00+08:00',
  updatedTimestamp: '2026-11-13T00:01:01+08:00',
  readings: { pm25_one_hourly: { west: 28, east: 18, central: 20, south: 17, north: 28 } },
};

const json = (item) => ({ code: 0, errorMsg: '', data: { regionMetadata: [], items: [item] } });

test('PSI and PM2.5 bands', () => {
  assert.equal(Lib.bandFor(Lib.PSI_BANDS, 50).key, 'good');
  assert.equal(Lib.bandFor(Lib.PSI_BANDS, 51).key, 'moderate');
  assert.equal(Lib.bandFor(Lib.PSI_BANDS, 100).key, 'moderate');
  assert.equal(Lib.bandFor(Lib.PSI_BANDS, 101).key, 'unhealthy');
  assert.equal(Lib.bandFor(Lib.PSI_BANDS, 201).key, 'very-unhealthy');
  assert.equal(Lib.bandFor(Lib.PSI_BANDS, 301).key, 'hazardous');
  assert.equal(Lib.bandFor(Lib.PM25_BANDS, 55).key, 'normal');
  assert.equal(Lib.bandFor(Lib.PM25_BANDS, 56).key, 'elevated');
  assert.equal(Lib.bandFor(Lib.PM25_BANDS, 251).key, 'very-high');
  assert.equal(Lib.bandFor(Lib.PSI_BANDS, null), null);
});

test('buildReadings maps both datasets by region', () => {
  const r = Lib.buildReadings(psiItem, pmItem);
  assert.deepEqual(r.regions.west, { psi24: 62, pm25: 28 });
  assert.deepEqual(r.regions.east, { psi24: 57, pm25: 18 });
  assert.equal(r.psiUpdated, '2026-11-12T21:01:00+08:00');
});

test('buildReadings tolerates a missing dataset', () => {
  const r = Lib.buildReadings(psiItem, null);
  assert.equal(r.regions.central.psi24, 62);
  assert.equal(r.regions.central.pm25, null);
});

test('overall is the highest regional PSI', () => {
  const r = Lib.buildReadings(psiItem, pmItem);
  assert.deepEqual(Lib.overall(r, 'psi24'), { value: 62, region: 'central' });
});

test('latestItem rejects bad responses', () => {
  assert.throws(() => Lib.latestItem(null, 'PSI'), /empty/);
  assert.throws(() => Lib.latestItem({ code: 5, errorMsg: 'nope' }, 'PSI'), /nope/);
  assert.throws(() => Lib.latestItem({ code: 0, data: { items: [] } }, 'PSI'), /no readings/);
});

test('fetchReadings combines both endpoints and reports partial failure', async () => {
  const ok = async (url) => ({ ok: true, json: async () => json(url.endsWith('/psi') ? psiItem : pmItem) });
  const full = await Lib.fetchReadings(ok);
  assert.equal(full.regions.north.pm25, 28);
  assert.deepEqual(full.errors, []);

  const partial = await Lib.fetchReadings(async (url) =>
    url.endsWith('/pm25') ? { ok: false, status: 503 } : ok(url));
  assert.equal(partial.regions.north.psi24, 61);
  assert.equal(partial.regions.north.pm25, null);
  assert.equal(partial.errors.length, 1);

  await assert.rejects(Lib.fetchReadings(async () => { throw new Error('offline'); }), /offline/);
});

test('evaluateAlert fires once when crossing, re-arms after dropping below', () => {
  const s = { region: 'west', threshold: 60 };
  const at = (v) => ({ regions: { west: { psi24: v, pm25: null } } });

  let ev = Lib.evaluateAlert(s, at(55), { above: false });
  assert.deepEqual([ev.notify, ev.above], [false, false]);

  ev = Lib.evaluateAlert(s, at(60), { above: false }); // at threshold counts
  assert.deepEqual([ev.notify, ev.above], [true, true]);

  ev = Lib.evaluateAlert(s, at(75), { above: true }); // still above: stay quiet
  assert.deepEqual([ev.notify, ev.above], [false, true]);

  ev = Lib.evaluateAlert(s, at(58), { above: true }); // drops below: re-arm
  assert.deepEqual([ev.notify, ev.above], [false, false]);

  ev = Lib.evaluateAlert(s, at(61), { above: false }); // crosses again
  assert.equal(ev.notify, true);
});

test('evaluateAlert ignores missing data and keeps prior state', () => {
  const ev = Lib.evaluateAlert({ region: 'west', threshold: 60 },
    { regions: { west: { psi24: null, pm25: 10 } } }, { above: true });
  assert.deepEqual(ev, { value: null, above: true, notify: false, known: false });
});

test('parseThreshold validates input', () => {
  assert.equal(Lib.parseThreshold('101'), 101);
  assert.equal(Lib.parseThreshold(' 75.4 '), 75);
  assert.equal(Lib.parseThreshold(''), null);
  assert.equal(Lib.parseThreshold('abc'), null);
  assert.equal(Lib.parseThreshold('0'), null);
  assert.equal(Lib.parseThreshold('501'), null);
});

test('alertMessage names region, value, band and threshold', () => {
  const m = Lib.alertMessage({ region: 'central', threshold: 101 }, 120);
  assert.match(m.title, /Central/);
  assert.match(m.body, /120 \(Unhealthy\).*101/);
});

test('formatTime shows Singapore time, with the date when not today', () => {
  const now = '2026-11-13T04:00:00Z';
  assert.match(Lib.formatTime('2026-11-13T00:01:01+08:00', now), /^12:01\s?am$/i);
  assert.match(Lib.formatTime('2026-11-12T21:01:00+08:00', now), /^12 Nov, 9:01\s?pm$/i);
  assert.equal(Lib.formatTime(null), '');
});
