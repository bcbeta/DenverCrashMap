const request = async (path, parameters = {}) => {
  const url = new URL(`/api${path}`, window.location.origin);
  Object.entries(parameters).forEach(([key, value]) => {
    if (value !== undefined && value !== null && value !== "") url.searchParams.set(key, value);
  });
  const response = await fetch(url);
  if (!response.ok) {
    const payload = await response.json().catch(() => ({}));
    throw new Error(payload.error || `Request failed (${response.status})`);
  }
  return response.json();
};

export const crashApi = {
  streets: () => request("/streets"),
  incidentsNear: ({ startDate, endDate, lat, lng, radiusInFeet }) =>
    request("/incidents", { startDate, endDate, lat, lng, radiusInFeet }),
  streetCenterline: ({ fullStreetName, from, to }) =>
    request("/street-centerlines", { fullStreetName, crossStreet1: from, crossStreet2: to }),
  bufferedStreet: ({ fullStreetName, from, to, bufferInFeet }) =>
    request("/buffered-street-centerlines", { fullStreetName, crossStreet1: from, crossStreet2: to, bufferInFeet }),
  streetIncidents: ({ fullStreetName, from, to, bufferInFeet, startDate, endDate }) =>
    request("/incidents/buffered-street", {
      fullStreetName,
      crossStreet1: from,
      crossStreet2: to,
      bufferInFeet,
      startDate,
      endDate,
    }),
  streetHistory: ({ fullStreetName, from, to, bufferInFeet }) =>
    request("/incidents/buffered-street/history", {
      fullStreetName,
      crossStreet1: from,
      crossStreet2: to,
      bufferInFeet,
    }),
};
