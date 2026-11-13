/* Pure helpers shared by the page, the service worker and the tests. */
(function (root, factory) {
  var lib = factory();
  if (typeof module === 'object' && module.exports) module.exports = lib;
  else root.HazeLib = lib;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';

  var API = {
    psi: 'https://api-open.data.gov.sg/v2/real-time/api/psi',
    pm25: 'https://api-open.data.gov.sg/v2/real-time/api/pm25',
  };

  var REGIONS = [
    { id: 'central', label: 'Central' },
    { id: 'north', label: 'North' },
    { id: 'south', label: 'South' },
    { id: 'east', label: 'East' },
    { id: 'west', label: 'West' },
  ];

  // `level` drives the colour (1 = best, 5 = worst) so both scales share a palette.
  var PSI_BANDS = [
    { max: 50, key: 'good', label: 'Good', level: 1 },
    { max: 100, key: 'moderate', label: 'Moderate', level: 2 },
    { max: 200, key: 'unhealthy', label: 'Unhealthy', level: 3 },
    { max: 300, key: 'very-unhealthy', label: 'Very unhealthy', level: 4 },
    { max: Infinity, key: 'hazardous', label: 'Hazardous', level: 5 },
  ];

  var PM25_BANDS = [
    { max: 55, key: 'normal', label: 'Normal', level: 1 },
    { max: 150, key: 'elevated', label: 'Elevated', level: 2 },
    { max: 250, key: 'high', label: 'High', level: 4 },
    { max: Infinity, key: 'very-high', label: 'Very high', level: 5 },
  ];

  var MIN_THRESHOLD = 1;
  var MAX_THRESHOLD = 500;

  function regionLabel(id) {
    for (var i = 0; i < REGIONS.length; i++) if (REGIONS[i].id === id) return REGIONS[i].label;
    return id;
  }

  function bandFor(bands, value) {
    if (typeof value !== 'number' || !isFinite(value)) return null;
    for (var i = 0; i < bands.length; i++) if (value <= bands[i].max) return bands[i];
    return null;
  }

  function num(v) {
    return typeof v === 'number' && isFinite(v) ? v : null;
  }

  /** Returns the latest item of a data.gov.sg real-time response, or throws. */
  function latestItem(json, name) {
    if (!json || typeof json !== 'object') throw new Error(name + ': empty response');
    if (json.code !== undefined && json.code !== 0) {
      throw new Error(name + ': ' + (json.errorMsg || 'API error ' + json.code));
    }
    var items = json.data && json.data.items;
    if (!Array.isArray(items) || !items.length) throw new Error(name + ': no readings');
    return items[items.length - 1];
  }

  function pick(item, key, region) {
    var table = item && item.readings && item.readings[key];
    return table ? num(table[region]) : null;
  }

  /** Combines the PSI and PM2.5 items (either may be null) into one structure. */
  function buildReadings(psiItem, pm25Item) {
    var regions = {};
    REGIONS.forEach(function (r) {
      regions[r.id] = {
        psi24: pick(psiItem, 'psi_twenty_four_hourly', r.id),
        pm25: pick(pm25Item, 'pm25_one_hourly', r.id),
      };
    });
    return {
      regions: regions,
      psiUpdated: psiItem ? psiItem.updatedTimestamp || psiItem.timestamp || null : null,
      pm25Updated: pm25Item ? pm25Item.updatedTimestamp || pm25Item.timestamp || null : null,
      fetchedAt: new Date().toISOString(),
      errors: [],
    };
  }

  function fetchJson(url, fetchImpl) {
    var ctrl = typeof AbortController !== 'undefined' ? new AbortController() : null;
    var timer = ctrl ? setTimeout(function () { ctrl.abort(); }, 15000) : null;
    return fetchImpl(url, {
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl ? ctrl.signal : undefined,
    })
      .then(function (res) {
        if (!res.ok) throw new Error('HTTP ' + res.status);
        return res.json();
      })
      .then(
        function (json) { if (timer) clearTimeout(timer); return json; },
        function (err) { if (timer) clearTimeout(timer); throw err; }
      );
  }

  /**
   * Fetches both datasets. Succeeds if at least one works; `errors` lists what failed.
   * `fetchImpl` is injectable for tests.
   */
  function fetchReadings(fetchImpl) {
    var f = fetchImpl || function (u, o) { return fetch(u, o); };
    var psiP = fetchJson(API.psi, f).then(function (j) { return latestItem(j, 'PSI'); });
    var pmP = fetchJson(API.pm25, f).then(function (j) { return latestItem(j, 'PM2.5'); });
    return Promise.allSettled([psiP, pmP]).then(function (res) {
      var psi = res[0], pm = res[1];
      if (psi.status === 'rejected' && pm.status === 'rejected') {
        throw new Error(psi.reason && psi.reason.message ? psi.reason.message : 'Network error');
      }
      var readings = buildReadings(
        psi.status === 'fulfilled' ? psi.value : null,
        pm.status === 'fulfilled' ? pm.value : null
      );
      if (psi.status === 'rejected') readings.errors.push('24-hr PSI: ' + psi.reason.message);
      if (pm.status === 'rejected') readings.errors.push('1-hr PM2.5: ' + pm.reason.message);
      return readings;
    });
  }

  /** NEA's national figure is the highest regional reading. */
  function overall(readings, field) {
    var best = null;
    REGIONS.forEach(function (r) {
      var v = readings.regions[r.id][field];
      if (v != null && (best === null || v > best.value)) best = { value: v, region: r.id };
    });
    return best;
  }

  /**
   * Edge-triggered alert: notify when the region's 24-hr PSI is at or above the
   * threshold and it was not already above at the previous check.
   */
  function evaluateAlert(settings, readings, state) {
    var prev = !!(state && state.above);
    var reg = readings.regions[settings.region];
    var value = reg ? reg.psi24 : null;
    if (value == null) return { value: null, above: prev, notify: false, known: false };
    var above = value >= settings.threshold;
    return { value: value, above: above, notify: above && !prev, known: true };
  }

  function alertMessage(settings, value) {
    var band = bandFor(PSI_BANDS, value);
    var region = regionLabel(settings.region);
    return {
      title: 'Haze alert: ' + region + ' PSI ' + value,
      body:
        region + ' 24-hr PSI is ' + value + (band ? ' (' + band.label + ')' : '') +
        ', at or above your threshold of ' + settings.threshold + '.',
    };
  }

  function parseThreshold(raw) {
    var n = Number(String(raw).trim());
    if (!isFinite(n) || String(raw).trim() === '') return null;
    n = Math.round(n);
    return n >= MIN_THRESHOLD && n <= MAX_THRESHOLD ? n : null;
  }

  /** "9:01 pm", or "12 Nov, 9:01 pm" when not from today (Singapore time). */
  function formatTime(iso, now) {
    if (!iso) return '';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return '';
    var tz = 'Asia/Singapore';
    var time = new Intl.DateTimeFormat('en-SG', { timeZone: tz, hour: 'numeric', minute: '2-digit', hour12: true }).format(d);
    var dayFmt = new Intl.DateTimeFormat('en-SG', { timeZone: tz, day: 'numeric', month: 'short' });
    var ref = now ? new Date(now) : new Date();
    if (dayFmt.format(d) === dayFmt.format(ref)) return time;
    return dayFmt.format(d) + ', ' + time;
  }

  return {
    API: API,
    REGIONS: REGIONS,
    PSI_BANDS: PSI_BANDS,
    PM25_BANDS: PM25_BANDS,
    MIN_THRESHOLD: MIN_THRESHOLD,
    MAX_THRESHOLD: MAX_THRESHOLD,
    regionLabel: regionLabel,
    bandFor: bandFor,
    latestItem: latestItem,
    buildReadings: buildReadings,
    fetchReadings: fetchReadings,
    overall: overall,
    evaluateAlert: evaluateAlert,
    alertMessage: alertMessage,
    parseThreshold: parseThreshold,
    formatTime: formatTime,
  };
});
