import { crashApi } from "./api.js";
import { COSTS, SEVERITY_LABELS, circleGeoJSON, maximumSeverity, summarize } from "./analytics.js";

const DENVER = { lat: 39.7392, lng: -104.9903, zoom: 13 };
const severityColors = { K: "#ef4444", A: "#eab308", B: "#145480", C: "#145480", O: "#145480" };
const currency = new Intl.NumberFormat("en-US", {
  style: "currency",
  currency: "USD",
  maximumFractionDigits: 0,
  notation: "compact",
});
const fullCurrency = new Intl.NumberFormat("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

const elements = Object.fromEntries(
  [
    "filter-panel", "report-panel", "street-tool", "radius-tool", "radius-note", "search-form", "from-date",
    "to-date", "distance", "distance-label", "street-fields", "street", "street-list", "from-cross", "to-cross",
    "apply-search", "open-filters", "close-filters", "open-report", "close-report", "selection-label", "crash-count",
    "crash-cost", "crash-tab-count", "severity-list", "crash-list", "history-chart", "toast", "loading",
  ].map((id) => [id, document.getElementById(id)]),
);

const state = {
  tool: "street",
  streets: [],
  selectedStreet: null,
  pin: null,
  incidents: null,
  history: [],
  layers: [],
  loading: false,
};

let map;
let AdvancedMarkerElement;
let infoWindow;
const overlays = { incidents: [], selection: [] };

function loadGoogleMaps(apiKey) {
  if (window.google?.maps?.importLibrary) return Promise.resolve();
  return new Promise((resolve, reject) => {
    const callbackName = "__denverCrashGoogleMapsReady";
    const script = document.createElement("script");
    window[callbackName] = () => {
      delete window[callbackName];
      resolve();
    };
    script.src = `https://maps.googleapis.com/maps/api/js?key=${encodeURIComponent(apiKey)}&v=weekly&loading=async&callback=${callbackName}`;
    script.async = true;
    script.onerror = () => reject(new Error("Google Maps could not be loaded."));
    document.head.append(script);
  });
}

async function initializeGoogleMap() {
  const apiKey = window.RUNTIME_CONFIG?.googleMapsApiKey;
  if (!apiKey) throw new Error("Set GOOGLE_MAPS_API_KEY before starting the app.");
  await loadGoogleMaps(apiKey);
  const [{ Map, InfoWindow }, markerLibrary] = await Promise.all([
    google.maps.importLibrary("maps"),
    google.maps.importLibrary("marker"),
  ]);
  AdvancedMarkerElement = markerLibrary.AdvancedMarkerElement;
  infoWindow = new InfoWindow();
  map = new Map(document.getElementById("map"), {
    center: { lat: DENVER.lat, lng: DENVER.lng },
    zoom: DENVER.zoom,
    mapId: window.RUNTIME_CONFIG?.googleMapsMapId || "DEMO_MAP_ID",
    mapTypeControl: false,
    streetViewControl: false,
    fullscreenControl: false,
    clickableIcons: false,
    gestureHandling: "greedy",
    zoomControlOptions: { position: google.maps.ControlPosition.RIGHT_CENTER },
  });
}

function localDate(daysAgo = 0) {
  const date = new Date();
  date.setDate(date.getDate() - daysAgo);
  return [date.getFullYear(), String(date.getMonth() + 1).padStart(2, "0"), String(date.getDate()).padStart(2, "0")].join("-");
}

function setDefaultsFromUrl() {
  const params = new URLSearchParams(location.search);
  elements["from-date"].value = params.get("fromDate") || localDate(365);
  elements["to-date"].value = params.get("toDate") || localDate();
  elements.distance.value = params.get("r") || "20";
  state.tool = params.get("tool") === "radius" || params.get("tool") === "Radius Search" ? "radius" : "street";
  elements.street.value = params.get("street") || "";
  const lat = Number(params.get("lat"));
  const lng = Number(params.get("lng"));
  if (Number.isFinite(lat) && Number.isFinite(lng)) state.pin = { lat, lng };
  setTool(state.tool, false);
}

function writeUrl() {
  const params = new URLSearchParams();
  params.set("tool", state.tool);
  params.set("fromDate", elements["from-date"].value);
  params.set("toDate", elements["to-date"].value);
  params.set("r", elements.distance.value);
  if (state.tool === "street" && elements.street.value) {
    params.set("street", elements.street.value);
    if (elements["from-cross"].value) params.set("crossStreet1", elements["from-cross"].value);
    if (elements["to-cross"].value) params.set("crossStreet2", elements["to-cross"].value);
  }
  if (state.tool === "radius" && state.pin) {
    params.set("lat", state.pin.lat.toFixed(6));
    params.set("lng", state.pin.lng.toFixed(6));
  }
  history.replaceState(null, "", `${location.pathname}?${params}`);
}

function setTool(tool, updateUrl = true) {
  state.tool = tool;
  const isStreet = tool === "street";
  elements["street-tool"].classList.toggle("active", isStreet);
  elements["radius-tool"].classList.toggle("active", !isStreet);
  elements["street-tool"].setAttribute("aria-selected", String(isStreet));
  elements["radius-tool"].setAttribute("aria-selected", String(!isStreet));
  elements["street-fields"].classList.toggle("hidden", !isStreet);
  elements["radius-note"].classList.toggle("hidden", isStreet);
  elements["distance-label"].textContent = isStreet ? "Buffer" : "Radius";
  document.getElementById("map").style.cursor = isStreet ? "grab" : "crosshair";
  updateApplyState();
  if (updateUrl) writeUrl();
}

function updateApplyState() {
  const streetReady = Boolean(state.selectedStreet);
  const radiusReady = Boolean(state.pin);
  elements["apply-search"].disabled = state.loading || (state.tool === "street" ? !streetReady : !radiusReady);
}

function setLoading(loading) {
  state.loading = loading;
  elements.loading.classList.toggle("visible", loading);
  elements.loading.setAttribute("aria-hidden", String(!loading));
  updateApplyState();
}

let toastTimer;
function showToast(message, isError = false) {
  clearTimeout(toastTimer);
  elements.toast.textContent = message;
  elements.toast.classList.toggle("error", isError);
  elements.toast.classList.add("visible");
  toastTimer = setTimeout(() => elements.toast.classList.remove("visible"), 4200);
}

function currentFilters() {
  return {
    startDate: elements["from-date"].value,
    endDate: elements["to-date"].value,
    bufferInFeet: Number(elements.distance.value),
    radiusInFeet: Number(elements.distance.value),
  };
}

function validateDatesAndDistance() {
  const { startDate, endDate, radiusInFeet } = currentFilters();
  if (!startDate || !endDate || startDate > endDate) throw new Error("Choose a valid date range.");
  if (!Number.isFinite(radiusInFeet) || radiusInFeet < 5 || radiusInFeet > 500) {
    throw new Error("Buffer or radius must be between 5 and 500 feet.");
  }
}

function clearSearchLayers() {
  overlays.incidents.forEach(({ marker }) => { marker.map = null; });
  overlays.selection.forEach((overlay) => {
    if ("map" in overlay) overlay.map = null;
    else if (typeof overlay.setMap === "function") overlay.setMap(null);
  });
  overlays.incidents = [];
  overlays.selection = [];
  infoWindow?.close();
}

function markerContent(severity) {
  const element = document.createElement("span");
  element.className = `crash-marker ${severity}`;
  element.setAttribute("aria-hidden", "true");
  return element;
}

function pinContent() {
  const element = document.createElement("span");
  element.className = "radius-pin";
  element.setAttribute("aria-hidden", "true");
  return element;
}

function crashIdentity(properties) {
  return properties.cdot_cuid ? `CDOT ${properties.cdot_cuid}` : `Denver DOTI ${properties.doti_incident_id || "incident"}`;
}

function crashType(properties) {
  if (properties.doti_bicycle_involved || properties.doti_bicycle_count) return "Bicycle crash";
  if (properties.doti_pedestrian_involved || properties.doti_pedestrian_count) return "Pedestrian crash";
  const nonMotorist = `${properties.cdot_tu_1_nm_type || ""} ${properties.cdot_tu_2_nm_type || ""}`.trim();
  return nonMotorist ? `${nonMotorist} crash` : "Motor vehicle crash";
}

function crashDate(properties) {
  const value = properties.doti_first_occurrence_date;
  if (!value) return "Date unavailable";
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? value : new Intl.DateTimeFormat("en-US", { dateStyle: "medium", timeStyle: "short" }).format(date);
}

function escapeHtml(value) {
  return String(value ?? "").replace(/[&<>'"]/g, (character) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", "'": "&#39;", '"': "&quot;" })[character]);
}

function popupHtml(properties) {
  const severity = maximumSeverity(properties);
  return `<div class="popup-card"><strong>${escapeHtml(crashType(properties))}</strong><br><small>${escapeHtml(SEVERITY_LABELS[severity])}</small><p>${escapeHtml(properties.doti_address || "Address unavailable")}</p><small>${escapeHtml(crashDate(properties))}<br>${escapeHtml(crashIdentity(properties))}</small></div>`;
}

function extendBoundsFromGeoJSON(bounds, geojson) {
  const visitCoordinates = (coordinates) => {
    if (!Array.isArray(coordinates)) return;
    if (typeof coordinates[0] === "number" && typeof coordinates[1] === "number") {
      bounds.extend({ lat: coordinates[1], lng: coordinates[0] });
      return;
    }
    coordinates.forEach(visitCoordinates);
  };
  const visit = (value) => {
    if (!value) return;
    if (value.type === "FeatureCollection") value.features?.forEach(visit);
    else if (value.type === "Feature") visit(value.geometry);
    else if (value.type === "GeometryCollection") value.geometries?.forEach(visit);
    else visitCoordinates(value.coordinates);
  };
  visit(geojson);
}

function addDataLayer(geojson, style) {
  const layer = new google.maps.Data({ map });
  layer.addGeoJson(geojson);
  layer.setStyle(style);
  overlays.selection.push(layer);
  return layer;
}

function renderMap(incidents, { centerline = null, buffer = null, pin = null } = {}) {
  clearSearchLayers();
  const bounds = new google.maps.LatLngBounds();

  if (buffer) {
    addDataLayer(buffer, { strokeColor: "#24715b", strokeWeight: 2, fillColor: "#24715b", fillOpacity: 0.1, zIndex: 1 });
    extendBoundsFromGeoJSON(bounds, buffer);
  }
  if (centerline) {
    addDataLayer(centerline, (feature) => {
      const speed = Number(feature.getProperty("speedlimit") || 0);
      return {
        strokeColor: speed >= 45 ? "#e33f36" : speed >= 35 ? "#ed8b2d" : speed >= 26 ? "#d1b925" : "#26a269",
        strokeWeight: 4,
        strokeOpacity: 0.9,
        zIndex: 2,
      };
    });
    extendBoundsFromGeoJSON(bounds, centerline);
  }
  if (pin) {
    const polygon = circleGeoJSON(pin.lat, pin.lng, Number(elements.distance.value));
    addDataLayer(polygon, { strokeColor: "#24715b", strokeWeight: 2, fillColor: "#24715b", fillOpacity: 0.1, zIndex: 1 });
    const pinMarker = new AdvancedMarkerElement({ map, position: pin, content: pinContent(), title: "Radius search center", zIndex: 5 });
    overlays.selection.push(pinMarker);
    extendBoundsFromGeoJSON(bounds, polygon);
  }

  (incidents?.features || []).forEach((feature) => {
    if (feature.geometry?.type !== "Point") return;
    const [lng, lat] = feature.geometry.coordinates;
    const marker = new AdvancedMarkerElement({
      map,
      position: { lat, lng },
      content: markerContent(maximumSeverity(feature.properties || {})),
      title: crashType(feature.properties || {}),
      zIndex: 4,
    });
    marker.addListener("click", () => {
      infoWindow.setContent(popupHtml(feature.properties || {}));
      infoWindow.open({ map, anchor: marker });
    });
    overlays.incidents.push({ marker, feature });
    bounds.extend({ lat, lng });
  });

  if (!bounds.isEmpty()) {
    const padding = innerWidth <= 750
      ? { top: 90, right: 35, bottom: 120, left: 35 }
      : { top: 150, right: 80, bottom: 80, left: 490 };
    map.fitBounds(bounds, padding);
    google.maps.event.addListenerOnce(map, "idle", () => {
      if (map.getZoom() > 17) map.setZoom(17);
    });
  }
}

function severityRows(summary) {
  const rows = Object.entries(SEVERITY_LABELS).map(([level, label]) => ({ label, count: summary.severity[level], color: severityColors[level] }));
  rows.push({ label: "Pedestrians", count: summary.pedestrians, color: "#6b7280", start: true });
  rows.push({ label: "Bicyclists", count: summary.bicycles, color: "#6b7280" });
  elements["severity-list"].innerHTML = rows.map((row) => `
    <div class="severity-row ${row.start ? "vru-start" : ""}">
      <i class="severity-dot" style="background:${row.color}"></i><span>${row.label}</span><strong>${row.count.toLocaleString()}</strong>
    </div>`).join("");
}

function renderCrashList(incidents) {
  const features = [...(incidents?.features || [])].sort((a, b) => String(b.properties?.doti_first_occurrence_date || "").localeCompare(String(a.properties?.doti_first_occurrence_date || "")));
  if (!features.length) {
    elements["crash-list"].innerHTML = '<div class="empty-state"><strong>No crashes found</strong>Try widening the date range or search area.</div>';
    return;
  }

  elements["crash-list"].innerHTML = features.map((feature, index) => {
    const properties = feature.properties || {};
    const severity = maximumSeverity(properties);
    return `<article class="crash-card" data-crash-index="${index}" style="--severity-color:${severityColors[severity]}">
      <div class="crash-card-head"><h4>${escapeHtml(crashType(properties))}</h4><span class="severity-badge">${severity}</span></div>
      <div class="crash-meta"><span>⌖ ${escapeHtml(properties.doti_address || "Location unavailable")}</span><span>◷ ${escapeHtml(crashDate(properties))}</span><span>№ ${escapeHtml(crashIdentity(properties))}</span></div>
    </article>`;
  }).join("");

  elements["crash-list"].querySelectorAll("[data-crash-index]").forEach((card) => {
    card.addEventListener("click", () => {
      const feature = features[Number(card.dataset.crashIndex)];
      if (feature.geometry?.type !== "Point") return;
      const [lng, lat] = feature.geometry.coordinates;
      map.panTo({ lat, lng });
      if (map.getZoom() < 16) map.setZoom(16);
      const match = overlays.incidents.find((item) => item.feature === feature);
      if (match) {
        infoWindow.setContent(popupHtml(feature.properties || {}));
        infoWindow.open({ map, anchor: match.marker });
      }
      if (innerWidth <= 750) elements["report-panel"].classList.remove("open");
    });
  });
}

function normalizeHistory(item) {
  return {
    year: item.year,
    fatalities: Number(item.fatalities || 0),
    serious: Number(item.seriousInjuries || item.serious_injuries || 0),
    crashes: Number(item.crashes || 0),
  };
}

function renderHistory(historyRows) {
  const rows = (historyRows || []).slice(-10).map(normalizeHistory);
  if (!rows.length) {
    elements["history-chart"].innerHTML = '<div class="empty-state"><strong>History is unavailable</strong>Yearly history is shown for street searches.</div>';
    return;
  }
  const max = Math.max(...rows.map((row) => row.crashes), 1);
  elements["history-chart"].innerHTML = rows.map((row) => {
    const minor = Math.max(0, row.crashes - row.fatalities - row.serious);
    const minorHeight = (minor / max) * 100;
    const seriousHeight = (row.serious / max) * 100;
    const fatalHeight = (row.fatalities / max) * 100;
    const totalHeight = ((minor + row.serious + row.fatalities) / max) * 100;
    return `<div class="chart-column" style="--height:${totalHeight}%">
      <div class="chart-tooltip"><strong>${row.year}</strong><br>${row.crashes} crashes<br>${row.serious} serious · ${row.fatalities} fatal</div>
      <div class="chart-stack" style="height:${Math.max(totalHeight, 1)}%">
        <span class="minor" style="height:${minorHeight}%"></span><span class="serious" style="height:${seriousHeight}%"></span><span class="fatal" style="height:${fatalHeight}%"></span>
      </div><span class="chart-year">${String(row.year).slice(-2)}</span>
    </div>`;
  }).join("");
}

function renderReport(incidents, label, historyRows = []) {
  state.incidents = incidents;
  state.history = historyRows;
  const summary = summarize(incidents);
  elements["selection-label"].textContent = label;
  elements["crash-count"].textContent = summary.crashes.toLocaleString();
  elements["crash-cost"].textContent = currency.format(summary.cost);
  elements["crash-cost"].title = fullCurrency.format(summary.cost);
  elements["crash-tab-count"].textContent = summary.crashes.toLocaleString();
  severityRows(summary);
  renderCrashList(incidents);
  renderHistory(historyRows);
}

function streetSelection() {
  return {
    ...currentFilters(),
    fullStreetName: state.selectedStreet?.fullName,
    from: elements["from-cross"].value || undefined,
    to: elements["to-cross"].value || undefined,
  };
}

async function searchStreet() {
  validateDatesAndDistance();
  const selection = streetSelection();
  if (!selection.fullStreetName) throw new Error("Choose a street from the list.");
  if (Boolean(selection.from) !== Boolean(selection.to)) throw new Error("Choose both cross streets, or leave both blank.");
  setLoading(true);
  try {
    const [centerline, buffer, incidents, historyRows] = await Promise.all([
      crashApi.streetCenterline(selection),
      crashApi.bufferedStreet(selection),
      crashApi.streetIncidents(selection),
      crashApi.streetHistory(selection),
    ]);
    renderMap(incidents, { centerline, buffer });
    const segment = selection.from && selection.to ? `${selection.fullStreetName}, ${selection.from} to ${selection.to}` : selection.fullStreetName;
    renderReport(incidents, `${segment} · ${selection.bufferInFeet} ft buffer`, historyRows);
    writeUrl();
    closeMobilePanel("filter-panel");
    if (innerWidth <= 750) elements["report-panel"].classList.add("open");
    showToast(`Found ${(incidents.features || []).length} crashes.`);
  } finally {
    setLoading(false);
  }
}

async function searchRadius() {
  validateDatesAndDistance();
  if (!state.pin) throw new Error("Click the map to choose a search center.");
  setLoading(true);
  try {
    const filters = currentFilters();
    const incidents = await crashApi.incidentsNear({ ...filters, ...state.pin });
    renderMap(incidents, { pin: state.pin });
    renderReport(incidents, `${filters.radiusInFeet} ft around ${state.pin.lat.toFixed(4)}, ${state.pin.lng.toFixed(4)}`, []);
    writeUrl();
    closeMobilePanel("filter-panel");
    if (innerWidth <= 750) elements["report-panel"].classList.add("open");
    showToast(`Found ${(incidents.features || []).length} crashes.`);
  } finally {
    setLoading(false);
  }
}

function selectStreetFromInput() {
  const query = elements.street.value.trim().toUpperCase();
  state.selectedStreet = state.streets.find((street) => street.fullName.toUpperCase() === query) || null;
  const crossings = state.selectedStreet?.crossingStreets || [];
  const currentParams = new URLSearchParams(location.search);
  for (const [id, parameter, placeholder] of [
    ["from-cross", "crossStreet1", "Any starting point"],
    ["to-cross", "crossStreet2", "Any ending point"],
  ]) {
    const select = elements[id];
    select.innerHTML = `<option value="">${placeholder}</option>${crossings.map((name) => `<option value="${escapeHtml(name)}">${escapeHtml(name)}</option>`).join("")}`;
    select.disabled = !state.selectedStreet;
    const requested = currentParams.get(parameter);
    if (requested && crossings.includes(requested)) select.value = requested;
  }
  updateApplyState();
  writeUrl();
}

function closeMobilePanel(id) {
  if (innerWidth <= 750) elements[id].classList.remove("open");
}

function bindEvents() {
  elements["street-tool"].addEventListener("click", () => setTool("street"));
  elements["radius-tool"].addEventListener("click", () => setTool("radius"));
  elements.street.addEventListener("input", selectStreetFromInput);
  elements["from-cross"].addEventListener("change", writeUrl);
  elements["to-cross"].addEventListener("change", writeUrl);
  elements["from-date"].addEventListener("change", writeUrl);
  elements["to-date"].addEventListener("change", writeUrl);
  elements.distance.addEventListener("change", () => {
    writeUrl();
    if (state.tool === "radius" && state.pin && state.incidents) renderMap(state.incidents, { pin: state.pin });
  });
  elements["search-form"].addEventListener("submit", async (event) => {
    event.preventDefault();
    try {
      if (state.tool === "street") await searchStreet();
      else await searchRadius();
    } catch (error) {
      setLoading(false);
      showToast(error.message, true);
    }
  });
  map.addListener("click", async ({ latLng }) => {
    if (state.tool !== "radius" || state.loading) return;
    if (!latLng) return;
    state.pin = { lat: latLng.lat(), lng: latLng.lng() };
    updateApplyState();
    writeUrl();
    try { await searchRadius(); } catch (error) { setLoading(false); showToast(error.message, true); }
  });
  document.querySelectorAll("[data-report-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      document.querySelectorAll("[data-report-tab]").forEach((tab) => {
        const active = tab === button;
        tab.classList.toggle("active", active);
        tab.setAttribute("aria-selected", String(active));
      });
      document.querySelectorAll(".report-section").forEach((section) => section.classList.remove("active"));
      document.getElementById(`${button.dataset.reportTab}-section`).classList.add("active");
    });
  });
  elements["open-filters"].addEventListener("click", () => elements["filter-panel"].classList.add("open"));
  elements["close-filters"].addEventListener("click", () => closeMobilePanel("filter-panel"));
  elements["open-report"].addEventListener("click", () => elements["report-panel"].classList.add("open"));
  elements["close-report"].addEventListener("click", () => closeMobilePanel("report-panel"));
}

async function initialize() {
  setDefaultsFromUrl();
  severityRows(summarize(null));
  renderCrashList(null);
  renderHistory([]);
  try {
    await initializeGoogleMap();
  } catch (error) {
    const mapStatus = document.getElementById("map-status");
    mapStatus.innerHTML = `<strong>Google Maps needs configuration</strong><span>${escapeHtml(error.message)}</span><code>GOOGLE_MAPS_API_KEY=your_key npm start</code>`;
    mapStatus.classList.remove("hidden");
    showToast(error.message, true);
    return;
  }
  bindEvents();
  try {
    state.streets = await crashApi.streets();
    elements["street-list"].innerHTML = state.streets.map((street) => `<option value="${escapeHtml(street.fullName)}"></option>`).join("");
    if (elements.street.value) selectStreetFromInput();
    const canRestoreStreet = state.tool === "street" && state.selectedStreet;
    const canRestoreRadius = state.tool === "radius" && state.pin;
    if (canRestoreStreet || canRestoreRadius) {
      try {
        if (canRestoreStreet) await searchStreet();
        else await searchRadius();
      } catch (error) {
        showToast(`Saved search could not be restored: ${error.message}`, true);
      }
    }
  } catch (error) {
    showToast(`Could not load streets: ${error.message}`, true);
  }
}

initialize();
