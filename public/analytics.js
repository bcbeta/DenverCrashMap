export const COSTS = {
  K: 1_598_800,
  A: 1_705_100,
  B: 384_000,
  C: 204_600,
  O: 18_100,
};

export const SEVERITY_LABELS = {
  K: "Fatal (K)",
  A: "Incapacitating Injury (A)",
  B: "Non-Incapacitating Injury (B)",
  C: "Complaint of Injury (C)",
  O: "No Injury, Property Damage (O)",
};

export function severityCounts(properties = {}) {
  if (properties.cdot_cuid) {
    return {
      K: properties.cdot_injury_04 || 0,
      A: properties.cdot_injury_03 || 0,
      B: properties.cdot_injury_02 || 0,
      C: properties.cdot_injury_01 || 0,
      O: properties.cdot_injury_00 || 0,
    };
  }

  const fatalities = properties.doti_fatalities || 0;
  const serious = properties.doti_serious_injuries || 0;
  return { K: fatalities, A: serious, B: 0, C: 0, O: Number(fatalities + serious === 0) };
}

export function maximumSeverity(properties = {}) {
  const counts = severityCounts(properties);
  return ["K", "A", "B", "C"].find((level) => counts[level] > 0) || "O";
}

export function vulnerableUsers(properties = {}) {
  if (properties.doti_incident_id) {
    return {
      bicycles: properties.doti_bicycle_count || Number(Boolean(properties.doti_bicycle_involved)),
      pedestrians: properties.doti_pedestrian_count || Number(Boolean(properties.doti_pedestrian_involved)),
    };
  }

  const bicycleTerms = ["bicycle", "bicyclist", "cyclist", "non-motorist", "scooter"];
  const pedestrianTerms = ["pedestrian", "personal conveyance", "wheelchair"];
  const modes = [properties.cdot_tu_1_nm_type, properties.cdot_tu_2_nm_type]
    .filter(Boolean)
    .map((value) => value.toLowerCase());
  const harmfulEvent = String(properties.cdot_mhe || "").toLowerCase();

  return {
    bicycles: modes.filter((mode) => bicycleTerms.some((term) => mode.includes(term))).length ||
      Number(bicycleTerms.some((term) => harmfulEvent.includes(term))),
    pedestrians: modes.filter((mode) => pedestrianTerms.some((term) => mode.includes(term))).length ||
      Number(pedestrianTerms.some((term) => harmfulEvent.includes(term))),
  };
}

export function summarize(featureCollection) {
  const features = featureCollection?.features || [];
  return features.reduce(
    (summary, feature) => {
      const properties = feature.properties || {};
      const severity = maximumSeverity(properties);
      const counts = severityCounts(properties);
      const vulnerable = vulnerableUsers(properties);
      summary.crashes += 1;
      summary.cost += COSTS[severity];
      summary.bicycles += vulnerable.bicycles;
      summary.pedestrians += vulnerable.pedestrians;
      Object.keys(summary.severity).forEach((level) => {
        summary.severity[level] += counts[level];
      });
      return summary;
    },
    { crashes: 0, cost: 0, bicycles: 0, pedestrians: 0, severity: { K: 0, A: 0, B: 0, C: 0, O: 0 } },
  );
}

export function circleGeoJSON(lat, lng, radiusFeet, points = 72) {
  const radiusKm = radiusFeet * 0.0003048;
  const longitudeOffset = radiusKm / (111.32 * Math.cos((lat * Math.PI) / 180));
  const latitudeOffset = radiusKm / 110.574;
  const coordinates = [];
  for (let index = 0; index < points; index += 1) {
    const angle = (index / points) * Math.PI * 2;
    coordinates.push([lng + longitudeOffset * Math.cos(angle), lat + latitudeOffset * Math.sin(angle)]);
  }
  coordinates.push(coordinates[0]);
  return { type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: [coordinates] } };
}
