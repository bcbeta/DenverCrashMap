const CRASH_LAYER = "https://services1.arcgis.com/zdB7qR0BtYrg0Xpl/ArcGIS/rest/services/ODC_CRIME_TRAFFICACCIDENTS5YR_P/FeatureServer/325";
const STREET_LAYER = "https://services-nocdn.arcgis.com/V6ZHFr6zdgNZuVG0/ArcGIS/rest/services/Denver_Streets_Centerline/FeatureServer/0";
const PAGE_SIZE = 2000;
const CRASH_FIELDS = [
  "object_id", "incident_id", "first_occurrence_date", "incident_address", "bicycle_ind", "pedestrian_ind",
  "HARMFUL_EVENT_SEQ_1", "HARMFUL_EVENT_SEQ_2", "HARMFUL_EVENT_SEQ_3", "ROAD_DESCRIPTION",
  "ROAD_CONTOUR", "ROAD_CONDITION", "LIGHT_CONDITION", "TU1_VEHICLE_TYPE", "TU1_PEDESTRIAN_ACTION",
  "TU2_VEHICLE_TYPE", "TU2_PEDESTRIAN_ACTION", "SERIOUSLY_INJURED", "FATALITIES", "FATALITY_MODE_1",
  "FATALITY_MODE_2", "SERIOUSLY_INJURED_MODE_1", "SERIOUSLY_INJURED_MODE_2",
].join(",");

const streetCache = new Map();
const bufferCache = new Map();
const streetCrashCache = new Map();

function requireTurf() {
  if (!globalThis.turf) throw new Error("The map geometry library did not load. Refresh the page and try again.");
  return globalThis.turf;
}

function sqlString(value) {
  return `'${String(value).replaceAll("'", "''")}'`;
}

async function fetchArcGis(url, parameters, { method = "GET" } = {}) {
  const params = new URLSearchParams(parameters);
  let response;
  if (method === "POST") {
    response = await fetch(url, { method, body: params });
  } else {
    response = await fetch(`${url}?${params}`);
  }
  if (!response.ok) throw new Error(`Denver Open Data request failed (${response.status}).`);
  const payload = await response.json();
  if (payload.error) {
    const detail = payload.error.details?.find(Boolean);
    throw new Error(detail || payload.error.message || "Denver Open Data could not complete the request.");
  }
  return payload;
}

async function pagedJson(layer, parameters) {
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchArcGis(`${layer}/query`, {
      ...parameters,
      f: "json",
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
    });
    features.push(...(page.features || []));
    if (!page.exceededTransferLimit && (page.features || []).length < PAGE_SIZE) break;
    if (!(page.features || []).length) break;
  }
  return features;
}

async function pagedGeoJson(layer, parameters, { method = "GET" } = {}) {
  const features = [];
  for (let offset = 0; ; offset += PAGE_SIZE) {
    const page = await fetchArcGis(`${layer}/query`, {
      ...parameters,
      f: "geojson",
      outSR: 4326,
      resultOffset: offset,
      resultRecordCount: PAGE_SIZE,
    }, { method });
    features.push(...(page.features || []));
    const exceeded = page.properties?.exceededTransferLimit || page.exceededTransferLimit;
    if (!exceeded && (page.features || []).length < PAGE_SIZE) break;
    if (!(page.features || []).length) break;
  }
  return { type: "FeatureCollection", features };
}

function normalizeCrash(feature) {
  const source = feature.properties || {};
  return {
    ...feature,
    properties: {
      ...source,
      doti_incident_id: source.incident_id,
      doti_first_occurrence_date: source.first_occurrence_date
        ? new Date(source.first_occurrence_date).toISOString()
        : null,
      doti_address: source.incident_address?.trim(),
      doti_bicycle_count: Number(source.bicycle_ind || 0),
      doti_pedestrian_count: Number(source.pedestrian_ind || 0),
      doti_bicycle_involved: Boolean(source.bicycle_ind),
      doti_pedestrian_involved: Boolean(source.pedestrian_ind),
      doti_serious_injuries: Number(source.SERIOUSLY_INJURED || 0),
      doti_fatalities: Number(source.FATALITIES || 0),
    },
  };
}

function uniqueCrashes(collection) {
  const seen = new Set();
  const features = collection.features.filter((feature) => {
    const key = feature.properties?.incident_id || feature.properties?.object_id || JSON.stringify(feature.geometry);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
  return { type: "FeatureCollection", features };
}

function collectRings(geometry, rings) {
  if (!geometry) return;
  if (geometry.type === "Polygon") rings.push(...geometry.coordinates);
  if (geometry.type === "MultiPolygon") geometry.coordinates.forEach((polygon) => rings.push(...polygon));
}

function esriPolygon(area) {
  const turf = requireTurf();
  const rings = [];
  turf.flattenEach(area, (feature) => {
    const rewound = turf.rewind(feature, { reverse: true, mutate: false });
    collectRings(rewound.geometry, rings);
  });
  return JSON.stringify({ rings, spatialReference: { wkid: 4326 } });
}

function pointInsideArea(feature, area) {
  const turf = requireTurf();
  let inside = false;
  turf.flattenEach(area, (polygon) => {
    if (!inside && turf.booleanPointInPolygon(feature, polygon)) inside = true;
  });
  return inside;
}

function dateWhere(startDate, endDate) {
  if (!startDate || !endDate) return "1=1";
  const endExclusive = new Date(`${endDate}T12:00:00`);
  endExclusive.setDate(endExclusive.getDate() + 1);
  const nextDate = [
    endExclusive.getFullYear(),
    String(endExclusive.getMonth() + 1).padStart(2, "0"),
    String(endExclusive.getDate()).padStart(2, "0"),
  ].join("-");
  return `first_occurrence_date >= DATE '${startDate}' AND first_occurrence_date < DATE '${nextDate}'`;
}

async function crashesInArea(area, startDate, endDate) {
  const collection = await pagedGeoJson(CRASH_LAYER, {
    where: dateWhere(startDate, endDate),
    geometry: esriPolygon(area),
    geometryType: "esriGeometryPolygon",
    inSR: 4326,
    spatialRel: "esriSpatialRelIntersects",
    outFields: CRASH_FIELDS,
    returnGeometry: true,
  }, { method: "POST" });
  const normalized = uniqueCrashes({
    type: "FeatureCollection",
    features: collection.features.map(normalizeCrash),
  });
  return {
    ...normalized,
    features: normalized.features.filter((feature) => pointInsideArea(feature, area)),
  };
}

async function allStreets() {
  const rows = await pagedJson(STREET_LAYER, {
    where: "FULLNAME IS NOT NULL",
    outFields: "FULLNAME",
    returnGeometry: false,
    returnDistinctValues: true,
    orderByFields: "FULLNAME",
  });
  return rows
    .map((row) => row.attributes?.FULLNAME?.trim())
    .filter(Boolean)
    .map((fullName) => ({ fullName }));
}

function streetKey({ fullStreetName, from, to }) {
  return [fullStreetName, from || "", to || ""].join("|");
}

function rawStreetFeatures(fullStreetName) {
  if (!streetCache.has(fullStreetName)) {
    streetCache.set(fullStreetName, pagedGeoJson(STREET_LAYER, {
      where: `FULLNAME = ${sqlString(fullStreetName)}`,
      outFields: "FID,FULLNAME,FROMNAME,TONAME,SPEEDLIMIT",
      returnGeometry: true,
      orderByFields: "FID",
    }).then((collection) => ({
      type: "FeatureCollection",
      features: collection.features.map((feature) => ({
        ...feature,
        properties: {
          ...feature.properties,
          speedlimit: feature.properties?.SPEEDLIMIT,
        },
      })),
    })));
  }
  return streetCache.get(fullStreetName);
}

function boundedFeatures(features, from, to) {
  if (!from && !to) return features;
  if (!from || !to) throw new Error("Choose both cross streets, or leave both blank.");
  if (from === to) throw new Error("Choose two different cross streets.");

  const adjacency = new Map();
  const add = (node, item) => {
    if (!node) return;
    if (!adjacency.has(node)) adjacency.set(node, []);
    adjacency.get(node).push(item);
  };
  features.forEach((feature, index) => {
    const a = feature.properties?.FROMNAME?.trim();
    const b = feature.properties?.TONAME?.trim();
    if (!a || !b) return;
    add(a, { index, next: b });
    add(b, { index, next: a });
  });

  const queue = [from];
  const visited = new Set([from]);
  const previous = new Map();
  while (queue.length && !visited.has(to)) {
    const node = queue.shift();
    for (const edge of adjacency.get(node) || []) {
      if (visited.has(edge.next)) continue;
      visited.add(edge.next);
      previous.set(edge.next, { node, index: edge.index });
      queue.push(edge.next);
    }
  }
  if (!visited.has(to)) throw new Error(`No connected ${from} to ${to} segment was found.`);

  const indexes = [];
  for (let node = to; node !== from;) {
    const step = previous.get(node);
    if (!step) break;
    indexes.push(step.index);
    node = step.node;
  }
  return [...new Set(indexes)].map((index) => features[index]);
}

async function streetGeometry(selection) {
  const collection = await rawStreetFeatures(selection.fullStreetName);
  const features = boundedFeatures(collection.features, selection.from, selection.to);
  if (!features.length) throw new Error(`No map geometry was found for ${selection.fullStreetName}.`);
  return { type: "FeatureCollection", features };
}

async function bufferedStreet(selection) {
  const key = `${streetKey(selection)}|${selection.bufferInFeet}`;
  if (!bufferCache.has(key)) {
    bufferCache.set(key, streetGeometry(selection).then((centerline) => {
      const turf = requireTurf();
      const pieces = turf.buffer(centerline, Number(selection.bufferInFeet), { units: "feet", steps: 8 });
      if (!pieces.features?.length) throw new Error("The selected street could not be buffered.");
      if (pieces.features.length === 1) return pieces.features[0];
      try {
        return turf.union(pieces);
      } catch {
        return pieces;
      }
    }));
  }
  return bufferCache.get(key);
}

async function allStreetCrashes(selection) {
  const key = `${streetKey(selection)}|${selection.bufferInFeet}`;
  if (!streetCrashCache.has(key)) {
    streetCrashCache.set(key, bufferedStreet(selection).then((area) => crashesInArea(area)));
  }
  return streetCrashCache.get(key);
}

function filterDates(collection, startDate, endDate) {
  const start = new Date(`${startDate}T00:00:00`).getTime();
  const end = new Date(`${endDate}T23:59:59.999`).getTime();
  return {
    type: "FeatureCollection",
    features: collection.features.filter((feature) => {
      const value = new Date(feature.properties?.doti_first_occurrence_date).getTime();
      return value >= start && value <= end;
    }),
  };
}

function historyRows(collection) {
  const years = new Map();
  collection.features.forEach((feature) => {
    const properties = feature.properties || {};
    const year = new Date(properties.doti_first_occurrence_date).getFullYear();
    if (!Number.isFinite(year)) return;
    if (!years.has(year)) years.set(year, { year, crashes: 0, fatalities: 0, seriousInjuries: 0 });
    const row = years.get(year);
    row.crashes += 1;
    row.fatalities += Number(properties.doti_fatalities || 0);
    row.seriousInjuries += Number(properties.doti_serious_injuries || 0);
  });
  return [...years.values()].sort((a, b) => a.year - b.year);
}

export const crashApi = {
  streets: allStreets,
  crossingStreets: async (fullStreetName) => {
    const collection = await rawStreetFeatures(fullStreetName);
    return [...new Set(collection.features.flatMap((feature) => [
      feature.properties?.FROMNAME?.trim(),
      feature.properties?.TONAME?.trim(),
    ]).filter(Boolean))].sort((a, b) => a.localeCompare(b));
  },
  incidentsNear: async ({ startDate, endDate, lat, lng, radiusInFeet }) => {
    const turf = requireTurf();
    const area = turf.circle([lng, lat], Number(radiusInFeet), { units: "feet", steps: 72 });
    return crashesInArea(area, startDate, endDate);
  },
  streetCenterline: streetGeometry,
  bufferedStreet,
  streetIncidents: async (selection) => filterDates(await allStreetCrashes(selection), selection.startDate, selection.endDate),
  streetHistory: async (selection) => historyRows(await allStreetCrashes(selection)),
};
