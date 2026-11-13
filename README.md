# Haze Tracker SG

A small installable web app (PWA) that shows Singapore's **24-hour PSI** and **1-hour PM2.5** for the five NEA regions (central, north, south, east, west) and can notify you when a region's PSI reaches a threshold you choose.

Data comes from NEA's real-time datasets on [data.gov.sg](https://data.gov.sg):

- `https://api-open.data.gov.sg/v2/real-time/api/psi` (24-hr PSI)
- `https://api-open.data.gov.sg/v2/real-time/api/pm25` (1-hr PM2.5)

NEA publishes the 1-hour reading as PM2.5 (µg/m³), not as a PSI value, so that is what the app shows.

## Run it

It is plain static files with no build step. Service workers and notifications need HTTPS (or `localhost`):

```sh
python3 -m http.server 8000   # then open http://localhost:8000
```

To use it on a phone, host the folder anywhere that serves HTTPS (for example GitHub Pages) and open the URL:

- **Android (Chrome):** menu → *Install app* / *Add to Home screen*.
- **iPhone/iPad (Safari, iOS 16.4+):** Share → *Add to Home Screen*, then open it from the Home Screen icon.

## Alerts

Pick a region and a PSI threshold, then tap **Turn on alerts**. You are notified when that region's 24-hr PSI goes from below the threshold to at or above it, and again only after it has dropped below and crossed once more.

Alerts are checked whenever the app refreshes (every 5 minutes while it is open). Where the browser supports Periodic Background Sync (installed PWAs on Android Chrome), checks also run in the background, but browsers decide when, so it isn't guaranteed. True push notifications while the app is closed would need a server that sends Web Push messages, which this static app doesn't have.

## Files

| File | Purpose |
| --- | --- |
| `index.html`, `styles.css`, `app.js` | UI |
| `lib.js` | Fetching, bands and alert logic (shared with the tests) |
| `store.js`, `alerts.js` | Settings storage and the check-and-notify routine used by both page and service worker |
| `sw.js` | Offline app shell, background check, notification clicks |
| `manifest.webmanifest`, `icons/` | Install metadata and app icons |

## Tests

```sh
node --test tests/lib.test.js
```

Contains information from the NEA real-time PSI and PM2.5 datasets accessed from data.gov.sg, made available under the [Singapore Open Data Licence v1.0](https://data.gov.sg/open-data-licence). Not an official NEA app.
