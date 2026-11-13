(function () {
  'use strict';

  var Lib = window.HazeLib;
  var Store = window.HazeStore;
  var Alerts = window.HazeAlerts;

  var REFRESH_MS = 5 * 60 * 1000;
  var STALE_MS = 2 * 60 * 1000;

  var $ = function (sel) { return document.querySelector(sel); };

  var settings = { enabled: false, region: 'central', threshold: 101 };
  var registration = null;
  var readings = null;
  var evaluation = null;
  var lastFetch = 0;
  var refreshing = false;
  var deferredInstall = null;

  var notificationsSupported = 'Notification' in window;
  var isIOS = /iphone|ipad|ipod/i.test(navigator.userAgent) ||
    (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  var isStandalone = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone === true;

  /* ---------- rendering ---------- */

  function setText(el, text) { el.textContent = text; }

  function metricHtml(cap, valueHtml, band) {
    var lvl = band ? band.level : 0;
    var label = band ? band.label : 'No data';
    return '<div class="metric lvl-' + lvl + '">' +
      '<span class="cap">' + cap + '</span>' +
      '<span class="num">' + valueHtml + '</span>' +
      '<span class="pill">' + label + '</span></div>';
  }

  function renderOverall() {
    var el = $('#overall');
    var top = readings && Lib.overall(readings, 'psi24');
    if (!top) { el.hidden = true; return; }
    var band = Lib.bandFor(Lib.PSI_BANDS, top.value);
    el.hidden = false;
    el.innerHTML =
      '<div class="big lvl-' + band.level + '" aria-hidden="true">' + top.value + '</div>' +
      '<div class="meta"><div class="cap">Singapore · 24-hr PSI</div>' +
      '<div class="label">' + band.label + ' (' + top.value + ')</div>' +
      '<div class="where">Highest region: ' + Lib.regionLabel(top.region) + '</div></div>';
  }

  function renderRegions() {
    var box = $('#regions');
    if (!readings) return;
    box.innerHTML = Lib.REGIONS.map(function (r) {
      var v = readings.regions[r.id];
      var psiBand = Lib.bandFor(Lib.PSI_BANDS, v.psi24);
      var pmBand = Lib.bandFor(Lib.PM25_BANDS, v.pm25);
      var tag = settings.enabled && settings.region === r.id ? '<span class="tag">Alert region</span>' : '';
      return '<article class="region" data-region="' + r.id + '">' +
        '<header><h3>' + r.label + '</h3>' + tag + '</header>' +
        '<div class="metrics">' +
        metricHtml('24-HR PSI', v.psi24 == null ? '–' : v.psi24, psiBand) +
        metricHtml('1-HR PM2.5', v.pm25 == null ? '–' : v.pm25 + '<small> µg/m³</small>', pmBand) +
        '</div></article>';
    }).join('');
  }

  function renderUpdated() {
    var el = $('#updated');
    if (!readings) { setText(el, refreshing ? 'Loading…' : 'No data yet'); return; }
    var t = Lib.formatTime(readings.psiUpdated || readings.pm25Updated);
    setText(el, t ? 'NEA data updated ' + t + ' SGT' : 'Updated');
  }

  function renderStatus(message, isError) {
    var el = $('#alert-status');
    el.classList.toggle('error', !!isError);
    if (message) { setText(el, message); return; }

    if (!notificationsSupported) {
      el.classList.add('error');
      setText(el, isIOS && !isStandalone
        ? 'On iPhone/iPad, add this app to your Home Screen and open it from there to turn on alerts.'
        : "This browser doesn't support notifications.");
      return;
    }
    if (Notification.permission === 'denied') {
      el.classList.add('error');
      setText(el, 'Notifications are blocked for this app. Allow them in your browser or phone settings, then try again.');
      return;
    }
    if (!settings.enabled) { setText(el, 'Alerts are off.'); return; }

    var text = 'Alerts on: ' + Lib.regionLabel(settings.region) + ' at PSI ' + settings.threshold + ' or higher.';
    var cur = readings && readings.regions[settings.region].psi24;
    if (cur != null) text += ' Right now it is ' + cur + '.';
    setText(el, text);
  }

  function renderSettingsControls() {
    $('#region').value = settings.region;
    $('#threshold').value = settings.threshold;
    $('#disable').hidden = !settings.enabled;
    $('#save').textContent = settings.enabled ? 'Update alert' : 'Turn on alerts';
    syncChips();
    $('#save').disabled = !notificationsSupported;
    $('#test').disabled = !notificationsSupported;
  }

  function syncChips() {
    var current = Lib.parseThreshold($('#threshold').value);
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.setAttribute('aria-pressed', String(Number(chip.dataset.threshold) === current));
    });
  }

  function renderAll() {
    renderUpdated();
    renderOverall();
    renderRegions();
    renderStatus();
  }

  function showBanner(text) {
    var el = $('#banner');
    el.hidden = !text;
    setText(el, text || '');
  }

  function renderLegend() {
    function items(bands, ranges) {
      return bands.map(function (b, i) {
        return '<li><span class="swatch lvl-' + b.level + '"></span>' + b.label + ' · ' + ranges[i] + '</li>';
      }).join('');
    }
    $('#legend-psi').innerHTML = items(Lib.PSI_BANDS, ['0–50', '51–100', '101–200', '201–300', '301+']);
    $('#legend-pm').innerHTML = items(Lib.PM25_BANDS, ['0–55', '56–150', '151–250', '251+']);
  }

  /* ---------- data ---------- */

  function refresh() {
    if (refreshing) return Promise.resolve();
    refreshing = true;
    $('#refresh').classList.add('busy');
    return Alerts.checkAlerts(registration).then(
      function (out) {
        readings = out.readings;
        evaluation = out.evaluation;
        lastFetch = Date.now();
        showBanner(readings.errors.length ? 'Some data is unavailable right now. ' + readings.errors.join(' · ') : '');
        return out;
      },
      function (err) {
        var msg = "Couldn't reach NEA's data service (" + (err && err.message ? err.message : 'network error') + ').';
        showBanner(readings ? msg + ' Showing the last saved readings.' : msg + ' Check your connection and try again.');
        if (!readings) $('#regions').innerHTML = '<p class="placeholder">No readings to show yet.</p>';
      }
    ).then(function (out) {
      refreshing = false;
      $('#refresh').classList.remove('busy');
      renderAll();
      return out;
    });
  }

  /* ---------- alerts ---------- */

  function ensurePermission() {
    if (!notificationsSupported) return Promise.resolve('unsupported');
    if (Notification.permission !== 'default') return Promise.resolve(Notification.permission);
    return Promise.resolve(Notification.requestPermission());
  }

  function registerBackgroundCheck(enable) {
    return navigator.serviceWorker.ready.then(function (reg) {
      if (!('periodicSync' in reg)) return;
      return enable
        ? reg.periodicSync.register('haze-check', { minInterval: 30 * 60 * 1000 })
        : reg.periodicSync.unregister('haze-check');
    }).catch(function () { /* optional enhancement */ });
  }

  function onSave(event) {
    event.preventDefault();
    var threshold = Lib.parseThreshold($('#threshold').value);
    if (threshold == null) {
      renderStatus('Enter a PSI threshold between ' + Lib.MIN_THRESHOLD + ' and ' + Lib.MAX_THRESHOLD + '.', true);
      $('#threshold').focus();
      return;
    }
    var region = $('#region').value;
    ensurePermission().then(function (perm) {
      if (perm !== 'granted') {
        renderStatus(perm === 'denied'
          ? 'Notifications are blocked for this app. Allow them in your browser or phone settings, then try again.'
          : 'Alerts need notification permission. Please allow it when prompted.', true);
        return;
      }
      settings = { enabled: true, region: region, threshold: threshold };
      return Store.set('settings', settings)
        .then(function () { return Store.set('alertState', { above: false }); })
        .then(function () { registerBackgroundCheck(true); return refresh(); })
        .then(function () {
          renderSettingsControls();
          var msg = 'Alerts on: ' + Lib.regionLabel(region) + ' at PSI ' + threshold + ' or higher.';
          var cur = readings && readings.regions[region].psi24;
          if (cur != null) msg += ' Right now it is ' + cur + (evaluation && evaluation.notify ? ' (already at or above your threshold, so a notification was sent).' : '.');
          renderStatus(msg);
        });
    });
  }

  function onDisable() {
    settings.enabled = false;
    Store.set('settings', settings).then(function () {
      registerBackgroundCheck(false);
      renderSettingsControls();
      renderAll();
    });
  }

  function onTest() {
    ensurePermission().then(function (perm) {
      if (perm !== 'granted') {
        renderStatus('Allow notifications first, then try the test again.', true);
        return;
      }
      var opts = { body: 'Notifications are working. You will be alerted when your threshold is reached.', icon: 'icons/icon-192.png', tag: 'haze-test' };
      var p = registration && registration.showNotification
        ? registration.showNotification('Haze Tracker test', opts)
        : Promise.resolve(new Notification('Haze Tracker test', opts));
      return p.then(function () { renderStatus('Test notification sent.'); });
    }).catch(function () { renderStatus("Couldn't show a notification on this device.", true); });
  }

  /* ---------- install ---------- */

  function setupInstall() {
    window.addEventListener('beforeinstallprompt', function (e) {
      e.preventDefault();
      deferredInstall = e;
      $('#install').hidden = false;
      $('#install-btn').hidden = false;
    });
    window.addEventListener('appinstalled', function () {
      deferredInstall = null;
      $('#install').hidden = true;
    });
    $('#install-btn').addEventListener('click', function () {
      if (!deferredInstall) return;
      deferredInstall.prompt();
      deferredInstall.userChoice.finally(function () {
        deferredInstall = null;
        $('#install').hidden = true;
      });
    });
    if (isIOS && !isStandalone) {
      $('#install').hidden = false;
      $('#ios-hint').hidden = false;
    }
  }

  /* ---------- boot ---------- */

  function init() {
    $('#region').innerHTML = Lib.REGIONS.map(function (r) {
      return '<option value="' + r.id + '">' + r.label + '</option>';
    }).join('');
    renderLegend();
    setupInstall();

    $('#refresh').addEventListener('click', refresh);
    $('#alert-form').addEventListener('submit', onSave);
    $('#disable').addEventListener('click', onDisable);
    $('#test').addEventListener('click', onTest);
    $('#threshold').addEventListener('input', syncChips);
    document.querySelectorAll('.chip').forEach(function (chip) {
      chip.addEventListener('click', function () {
        $('#threshold').value = chip.dataset.threshold;
        syncChips();
      });
    });

    setInterval(function () {
      if (document.visibilityState === 'visible') refresh();
    }, REFRESH_MS);
    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && Date.now() - lastFetch > STALE_MS) refresh();
    });
    window.addEventListener('online', refresh);

    var swReady = 'serviceWorker' in navigator
      ? navigator.serviceWorker.register('sw.js')
          .then(function () { return navigator.serviceWorker.ready; })
          .then(function (reg) { registration = reg; })
          .catch(function () { /* app still works without a service worker */ })
      : Promise.resolve();

    Promise.all([Store.get('settings'), Store.get('lastReadings')]).then(function (res) {
      if (res[0]) settings = Object.assign(settings, res[0]);
      if (res[1]) {
        readings = res[1];
        showBanner('Showing saved readings while the latest data loads…');
      }
      renderSettingsControls();
      renderAll();
      return swReady;
    }).then(function () {
      return refresh();
    }).then(function () {
      if (settings.enabled) registerBackgroundCheck(true);
    });
  }

  init();
})();
