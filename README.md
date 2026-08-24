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

Node 20+ is the only local dependency.

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

## Map tiles

The basemap uses OpenStreetMap through Leaflet. For a production deployment with meaningful traffic, configure a commercial or self-hosted tile provider and follow its usage policy.

## Clean-room note

This implementation reproduces public behavior and data contracts, but does not copy the reference site's branding or source code. The interface and implementation are original and intentionally easy to modify.
