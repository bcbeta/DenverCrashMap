# Denver Crash Explorer

A clean-room, extensible recreation of the interactive functionality at `denver.zerovision.dev/map`.

It supports:

- street-segment search with optional cross-street bounds;
- point-and-radius search by clicking the map;
- date and buffer/radius filters with shareable URL state;
- crash points, street centerlines, buffered areas, and radius overlays;
- KABCO summary counts, comprehensive crash costs, pedestrian/bicyclist totals;
- crash detail cards and a severity-history chart;
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

The browser reads the City and County of Denver's official ArcGIS crash and street-centerline layers directly. The crash layer contains the previous five calendar years plus the current year to date. No application server or API key is required.

The data adapter and spatial-query logic are isolated in `public/api.js`; the calculation layer is in `public/analytics.js`.

## Deployment

Pushes to `main` deploy the contents of `public/` to GitHub Pages through `.github/workflows/pages.yml`.

## Map tiles

The basemap uses OpenStreetMap through Leaflet. For a production deployment with meaningful traffic, configure a commercial or self-hosted tile provider and follow its usage policy.

## Clean-room note

This implementation reproduces public behavior and data contracts, but does not copy the reference site's branding or source code. The interface and implementation are original and intentionally easy to modify.
