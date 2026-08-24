# Denver Crash Explorer

A clean-room, extensible recreation of the interactive functionality at `denver.zerovision.dev/map`.

It supports:

- street-segment search with optional cross-street bounds;
- point-and-radius search by clicking the map;
- date and buffer/radius filters with shareable URL state;
- crash points, street centerlines, buffered areas, and radius overlays;
- KABCO summary counts, comprehensive crash costs, pedestrian/bicyclist totals;
- crash detail cards and a ten-year severity-history chart;
- responsive desktop and mobile layouts.

## Run it

Node 20+ is the only local dependency. Create the private local configuration file once:

```bash
cp .env.example .env
```

Open `.env`, replace `your_browser_api_key`, then start the app:

```bash
npm start
```

Open <http://localhost:4173>.

For automatic server restarts while editing:

```bash
npm run dev
```

Run the unit tests with:

```bash
npm test
```

## Data source

The local server proxies a small allowlist of read-only endpoints from the reference application's public API. This avoids browser CORS issues and keeps the frontend independent of a hard-coded backend contract. To point the project at a compatible API:

```bash
CRASH_API_URL=https://your-host.example/api npm start
```

The API adapter is isolated in `public/api.js`; the calculation layer is in `public/analytics.js`.

## Google Maps

The basemap uses the Google Maps JavaScript API. Enable that API in a Google Cloud project, use a billing-enabled project where required, and restrict the browser key to your local and deployed HTTP referrers. `DEMO_MAP_ID` is used for development unless `GOOGLE_MAPS_MAP_ID` is provided.

The server automatically reads `.env`, which is excluded by `.gitignore`. This repository intentionally does not commit a key.

## Clean-room note

This implementation reproduces public behavior and data contracts, but does not copy the reference site's branding or source code. The interface and implementation are original and intentionally easy to modify.
