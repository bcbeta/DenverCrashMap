import test from "node:test";
import assert from "node:assert/strict";
import { circleGeoJSON, maximumSeverity, severityCounts, summarize } from "../public/analytics.js";

test("derives CDOT KABCO counts and maximum severity", () => {
  const properties = { cdot_cuid: "1", cdot_injury_04: 0, cdot_injury_03: 1, cdot_injury_02: 2 };
  assert.deepEqual(severityCounts(properties), { K: 0, A: 1, B: 2, C: 0, O: 0 });
  assert.equal(maximumSeverity(properties), "A");
});

test("summarizes costs and vulnerable users", () => {
  const collection = {
    type: "FeatureCollection",
    features: [
      { properties: { doti_incident_id: "one", doti_fatalities: 1, doti_bicycle_count: 1 } },
      { properties: { doti_incident_id: "two", doti_serious_injuries: 1, doti_pedestrian_count: 2 } },
    ],
  };
  const result = summarize(collection);
  assert.equal(result.crashes, 2);
  assert.equal(result.cost, 1_598_800 + 1_705_100);
  assert.equal(result.bicycles, 1);
  assert.equal(result.pedestrians, 2);
});

test("builds a closed radius polygon", () => {
  const polygon = circleGeoJSON(39.74, -104.99, 500, 16);
  assert.equal(polygon.geometry.coordinates[0].length, 17);
  assert.deepEqual(polygon.geometry.coordinates[0][0], polygon.geometry.coordinates[0][16]);
});
