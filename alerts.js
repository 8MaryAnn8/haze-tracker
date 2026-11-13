/* Fetch + evaluate + notify. Used by the page and by the service worker. */
(function (root) {
  'use strict';

  var Lib = root.HazeLib;
  var Store = root.HazeStore;

  function canNotify() {
    return typeof Notification !== 'undefined' && Notification.permission === 'granted';
  }

  function showAlert(registration, settings, value) {
    var msg = Lib.alertMessage(settings, value);
    var options = {
      body: msg.body,
      icon: 'icons/icon-192.png',
      tag: 'haze-alert',
      renotify: true,
      data: { url: './' },
    };
    if (registration && registration.showNotification) {
      return registration.showNotification(msg.title, options);
    }
    new Notification(msg.title, options);
    return Promise.resolve();
  }

  /**
   * Fetches the latest readings, stores them, and sends a notification if the
   * user's region has crossed their threshold since the last check.
   * Resolves with { readings, evaluation, notified }; rejects if NEA can't be reached.
   */
  function checkAlerts(registration) {
    return Lib.fetchReadings().then(function (readings) {
      var out = { readings: readings, evaluation: null, notified: false };
      return Store.set('lastReadings', readings)
        .then(function () { return Store.get('settings'); })
        .then(function (settings) {
          if (!settings || !settings.enabled) return out;
          return Store.get('alertState').then(function (state) {
            var ev = Lib.evaluateAlert(settings, readings, state);
            out.evaluation = ev;
            if (!ev.known) return out;
            var send = Promise.resolve();
            if (ev.notify) {
              // Without permission, leave the state alone so the alert can still
              // fire once permission is granted.
              if (!canNotify()) return out;
              send = showAlert(registration, settings, ev.value).then(function () {
                out.notified = true;
              });
            }
            return send.then(function () {
              return Store.set('alertState', {
                above: ev.above,
                value: ev.value,
                checkedAt: new Date().toISOString(),
              });
            }).then(function () { return out; });
          });
        });
    });
  }

  root.HazeAlerts = { checkAlerts: checkAlerts, showAlert: showAlert, canNotify: canNotify };
})(typeof self !== 'undefined' ? self : this);
