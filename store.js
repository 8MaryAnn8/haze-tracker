/* Tiny key-value store on IndexedDB, readable from both the page and the service worker.
   Falls back to memory if IndexedDB is unavailable (e.g. some private modes). */
(function (root) {
  'use strict';

  var DB_NAME = 'haze-tracker';
  var STORE = 'kv';
  var memory = {};
  var dbPromise = null;

  function open() {
    if (!dbPromise) {
      dbPromise = new Promise(function (resolve, reject) {
        if (typeof indexedDB === 'undefined') return reject(new Error('no indexedDB'));
        var req = indexedDB.open(DB_NAME, 1);
        req.onupgradeneeded = function () { req.result.createObjectStore(STORE); };
        req.onsuccess = function () { resolve(req.result); };
        req.onerror = function () { reject(req.error); };
      });
    }
    return dbPromise;
  }

  function get(key) {
    return open().then(
      function (db) {
        return new Promise(function (resolve, reject) {
          var req = db.transaction(STORE, 'readonly').objectStore(STORE).get(key);
          req.onsuccess = function () { resolve(req.result); };
          req.onerror = function () { reject(req.error); };
        });
      }
    ).catch(function () { return memory[key]; });
  }

  function set(key, value) {
    memory[key] = value;
    return open().then(
      function (db) {
        return new Promise(function (resolve, reject) {
          var tx = db.transaction(STORE, 'readwrite');
          tx.objectStore(STORE).put(value, key);
          tx.oncomplete = function () { resolve(); };
          tx.onerror = function () { reject(tx.error); };
        });
      }
    ).catch(function () { /* memory copy is enough */ });
  }

  root.HazeStore = { get: get, set: set };
})(typeof self !== 'undefined' ? self : this);
