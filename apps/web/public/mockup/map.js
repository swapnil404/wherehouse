/* ==========================================================================
   Wherehouse — map screen mockup

   What is REAL here:
     - dark vector basemap over actual Austin / Travis County geography
     - a genuine H3 res-8 grid, computed client-side with h3-js
     - real H3 cell ids, real cell counts, real polygon->cells batch selection
     - real preset weight vectors and real hard-constraint rule text (§8.5)
     - real catchment band definitions (§7)

   What is PLACEHOLDER:
     - every score, subscore, population figure and narrative string.
       These come from the FastAPI sidecar's /v1/* endpoints, which do not
       exist yet, so they render as quiet shimmer skeletons.

   Nothing in this file fabricates a number that would come from the engine.
   ========================================================================== */

/* -------------------------------------------------------------------------
   0. Constants
   ------------------------------------------------------------------------- */

const AUSTIN = { lng: -97.7431, lat: 30.2672 };
const H3_RES = 8;

// Approximate Travis County outline (GeoJSON winding: [lng, lat]), scaled so
// its area lands at 2,648 km² against the county's actual 2,657 km² — which
// polyfills to ~3,590 res-8 cells, matching §4.1's estimate. Deliberately a
// coarse 12-vertex shape; the real boundary arrives with the ingest pipeline.
const TRAVIS = [
  [
    [-98.1346, 30.3131],
    [-98.08, 30.4788],
    [-97.9143, 30.5024],
    [-97.8525, 30.6025],
    [-97.7069, 30.6025],
    [-97.5795, 30.5061],
    [-97.4084, 30.4132],
    [-97.4084, 30.224],
    [-97.4903, 30.0856],
    [-97.7251, 30.0511],
    [-97.9162, 30.1493],
    [-98.0982, 30.2094],
    [-98.1346, 30.3131],
  ],
];

// Real preset weight vectors. Each sums to 100.
const LAYER_KEYS = [
  { k: "demographics", name: "Demographics" },
  { k: "transportation", name: "Transportation" },
  { k: "poi", name: "Points of interest" },
  { k: "zoning", name: "Zoning" },
  { k: "flood", name: "Flood risk" },
  { k: "aqi", name: "Air quality" },
];

const PRESETS = {
  retail: {
    label: "Retail",
    w: { demographics: 35, transportation: 20, poi: 25, zoning: 10, flood: 7, aqi: 3 },
    cons: [
      ["Population within 5 km", "≥ 25,000"],
      ["Not in a FEMA special flood hazard area", "Zone A / AE / VE excluded"],
      ["Zone class in", "C-1, C-2, CS, LR"],
      ["Distance to highway", "≤ 3.0 km"],
    ],
  },
  warehouse: {
    label: "Warehouse",
    w: { demographics: 15, transportation: 35, poi: 15, zoning: 20, flood: 12, aqi: 3 },
    cons: [
      ["Population within 5 km", "≥ 5,000"],
      ["Not in a FEMA special flood hazard area", "Zone A / AE / VE excluded"],
      ["Zone class in", "LI, MI, IP, W/LO"],
      ["Distance to highway", "≤ 1.5 km"],
    ],
  },
  ev: {
    label: "EV charging",
    w: { demographics: 25, transportation: 30, poi: 20, zoning: 10, flood: 10, aqi: 5 },
    cons: [
      ["Population within 5 km", "≥ 12,000"],
      ["Not in a FEMA special flood hazard area", "Zone A / AE / VE excluded"],
      ["Zone class in", "C-1, C-2, CS, GR, LI"],
      ["Distance to highway", "≤ 2.0 km"],
    ],
  },
};

// Real §7 catchment bands. Transit is knowingly out of scope (§4.2).
const CATCH_BANDS = [
  ["Car", "10 min"],
  ["Car", "20 min"],
  ["Car", "30 min"],
  ["Walk", "10 min"],
  ["Walk", "20 min"],
];

const LAYERS = [
  { id: "grid", name: "H3 grid · res 8", badge: "local", live: 1, on: 1, legend: "grid" },
  { id: "score", name: "Score heatmap", badge: "pending", legend: "seq" },
  { id: "hotspots", name: "Hot / cold spots (Gi*)", badge: "pending", legend: "div" },
  { id: "poi", name: "Competitors & POI", badge: "PostGIS", legend: "cat" },
  { id: "zoning", name: "Land use & zoning", badge: "PMTiles", legend: "zoning" },
  { id: "flood", name: "Flood hazard (FEMA)", badge: "PMTiles", legend: "flood" },
  { id: "aqi", name: "Air quality (AQI)", badge: "GeoTIFF", legend: "aqi" },
  { id: "roads", name: "Road network", badge: "PMTiles", legend: null },
];

const $ = (s, r = document) => r.querySelector(s);
const $$ = (s, r = document) => [...r.querySelectorAll(s)];
const el = (t, c, h) => {
  const n = document.createElement(t);
  if (c) n.className = c;
  if (h != null) n.innerHTML = h;
  return n;
};
const fmt = (n) => n.toLocaleString("en-US");

/* A shimmer span. `w` may be a px number or a css length. */
const sk = (w, h = 9, d = 0) =>
  `<span class="sk" style="width:${typeof w === "number" ? w + "px" : w};height:${h}px;--d:${d.toFixed(2)}s"></span>`;

/* Deterministic pseudo-random so the placeholder geometry is stable across
   reloads. This drives BAR WIDTHS ONLY — never a displayed value. */
let _seed = 20260904;
const rnd = () => {
  _seed = (_seed * 1103515245 + 12345) & 0x7fffffff;
  return _seed / 0x7fffffff;
};

/* -------------------------------------------------------------------------
   1. State
   ------------------------------------------------------------------------- */

const state = {
  preset: "retail",
  weights: { ...PRESETS.retail.w },
  modified: false,
  layers: Object.fromEntries(LAYERS.map((l) => [l.id, !!l.on])),
  legend: "grid",
  tool: "pin",
  pin: null, // { lng, lat, cell }
  gridCells: [],
  selection: null, // { cells: [...] }
  drawing: [],
  // MapLibre feature-state needs integer ids. H3 res-8 indices end in seven
  // 'f' padding digits, so any hash of the tail collides — keep an explicit map.
  cellId: new Map(),
};

/* -------------------------------------------------------------------------
   2. Map
   ------------------------------------------------------------------------- */

const map = new maplibregl.Map({
  container: "map",
  style: "https://basemaps.cartocdn.com/gl/dark-matter-gl-style/style.json",
  center: [AUSTIN.lng, AUSTIN.lat],
  zoom: 10.4,
  attributionControl: { compact: true },
  dragRotate: false,
});

map.on("load", () => {
  darkenBasemap();
  buildGrid();
  addSources();
  wireMapInteractions();
  updateZoomReadout();
  updateScalebar();
  renderLegend(); // now that the real cell count exists
  // Open with a candidate already selected — the panel is the point of the screen.
  setPin(-97.7368, 30.2915);
});

/* Push CARTO dark-matter toward the near-black of the reference designs, and
   quiet the label layer so the floating panels stay the brightest thing. */
function darkenBasemap() {
  const set = (id, prop, val) => {
    try {
      map.setPaintProperty(id, prop, val);
    } catch {
      /* layer absent in this style version — ignore */
    }
  };
  for (const l of map.getStyle().layers) {
    if (l.type === "background") set(l.id, "background-color", "#08080a");
    else if (l.type === "fill" && /water|ocean/i.test(l.id))
      set(l.id, "fill-color", "#0c0c11");
    else if (l.type === "fill" && /park|green|wood|landuse/i.test(l.id))
      set(l.id, "fill-opacity", 0.28);
    else if (l.type === "symbol") set(l.id, "text-opacity", 0.5);
  }
}

/* Genuine H3 res-8 polyfill of the Travis County outline. */
function buildGrid() {
  const t0 = performance.now();
  state.gridCells = h3.polygonToCells(TRAVIS, H3_RES, true);
  const ms = Math.round(performance.now() - t0);
  console.info(
    `[wherehouse] H3 res-${H3_RES} polyfill: ${state.gridCells.length} cells in ${ms}ms`
  );
  const n = state.gridCells.length;
  $("#w-foot-txt").innerHTML =
    `Renormalised to 100. Subscores are weight-independent, so re-scoring ` +
    `<b style="color:var(--ink-2)">${fmt(n)} cells</b> is client-side — no network call.`;
}

function idFor(cell) {
  let id = state.cellId.get(cell);
  if (id === undefined) {
    id = state.cellId.size + 1;
    state.cellId.set(cell, id);
  }
  return id;
}

function cellsToFC(cells) {
  return {
    type: "FeatureCollection",
    features: cells.map((c) => ({
      type: "Feature",
      id: idFor(c),
      properties: { cell: c },
      geometry: { type: "Polygon", coordinates: [h3.cellToBoundary(c, true)] },
    })),
  };
}

function addSources() {
  map.addSource("grid", { type: "geojson", data: cellsToFC(state.gridCells) });

  // Flat, uniform fill. Visibly a grid, not a choropleth — no score implied.
  map.addLayer({
    id: "grid-fill",
    type: "fill",
    source: "grid",
    paint: {
      "fill-color": "#ffffff",
      "fill-opacity": [
        "case",
        ["boolean", ["feature-state", "hot"], false],
        0.09,
        ["boolean", ["feature-state", "hover"], false],
        0.055,
        0.016,
      ],
    },
  });
  map.addLayer({
    id: "grid-line",
    type: "line",
    source: "grid",
    paint: {
      "line-color": "#ffffff",
      "line-opacity": ["interpolate", ["linear"], ["zoom"], 9, 0.04, 13, 0.1],
      "line-width": 0.5,
    },
  });

  // Batch selection (polygon / radius) — cream stroke, faint fill.
  map.addSource("sel", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "sel-fill",
    type: "fill",
    source: "sel",
    paint: { "fill-color": "#ead9ab", "fill-opacity": 0.06 },
  });
  map.addLayer({
    id: "sel-line",
    type: "line",
    source: "sel",
    paint: { "line-color": "#ead9ab", "line-width": 1.4, "line-opacity": 0.75 },
  });

  // Cells captured by the current selection.
  map.addSource("selcells", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "selcells-line",
    type: "line",
    source: "selcells",
    paint: { "line-color": "#ead9ab", "line-width": 0.6, "line-opacity": 0.34 },
  });

  // In-progress draw vertices.
  map.addSource("verts", { type: "geojson", data: emptyFC() });
  map.addLayer({
    id: "verts-pt",
    type: "circle",
    source: "verts",
    paint: {
      "circle-radius": 3.4,
      "circle-color": "#ead9ab",
      "circle-stroke-width": 2,
      "circle-stroke-color": "#08080a",
    },
  });
}

const emptyFC = () => ({ type: "FeatureCollection", features: [] });

/* -------------------------------------------------------------------------
   3. Map interactions
   ------------------------------------------------------------------------- */

let hoverId = null;
let pinMarker = null;

function wireMapInteractions() {
  map.on("mousemove", "grid-fill", (e) => {
    if (state.tool !== "pin") return;
    const f = e.features[0];
    if (!f) return;
    if (hoverId !== null)
      map.setFeatureState({ source: "grid", id: hoverId }, { hover: false });
    hoverId = f.id;
    map.setFeatureState({ source: "grid", id: hoverId }, { hover: true });
    map.getCanvas().style.cursor = "crosshair";
  });

  map.on("mouseleave", "grid-fill", () => {
    if (hoverId !== null)
      map.setFeatureState({ source: "grid", id: hoverId }, { hover: false });
    hoverId = null;
    map.getCanvas().style.cursor = "";
  });

  map.on("click", (e) => {
    const { lng, lat } = e.lngLat;
    if (state.tool === "pin") return setPin(lng, lat);
    if (state.tool === "poly") return addVertex(lng, lat);
    if (state.tool === "radius") return setRadius(lng, lat);
  });

  map.on("dblclick", (e) => {
    if (state.tool === "poly") {
      e.preventDefault();
      closePolygon();
    }
  });

  map.on("move", () => {
    drawLeader();
    updateZoomReadout();
    updateScalebar();
  });
  map.on("zoom", () => {
    updateZoomReadout();
    updateScalebar();
  });
}

function setPin(lng, lat) {
  const cell = h3.latLngToCell(lat, lng, H3_RES);
  state.pin = { lng, lat, cell };

  if (!pinMarker) {
    const node = el("div");
    node.style.cssText = `
      width:15px;height:15px;border-radius:50%;
      background:#ead9ab;border:3px solid #08080a;
      box-shadow:0 0 0 1px rgba(234,217,171,.55), 0 0 18px 3px rgba(234,217,171,.28);
      cursor:pointer;`;
    pinMarker = new maplibregl.Marker({ element: node }).setLngLat([lng, lat]).addTo(map);
  } else {
    pinMarker.setLngLat([lng, lat]);
  }

  $("#sp-coords").textContent = `${lat.toFixed(5)}, ${lng < 0 ? "−" : ""}${Math.abs(lng).toFixed(5)}`;
  $("#sp-cell").textContent = cell;
  $("#sp-cell-2").textContent = cell.slice(0, 9) + "…";
  $("#score-panel").style.display = "";
  drawLeader();
}

/* Thin connector tying the fixed panel back to the point it describes. */
function drawLeader() {
  const svg = $("#leader");
  svg.innerHTML = "";
  const panel = $("#score-panel");
  if (!state.pin || panel.style.display === "none") return;

  const p = map.project([state.pin.lng, state.pin.lat]);
  const stage = $("#stage").getBoundingClientRect();
  const pr = panel.getBoundingClientRect();
  const tx = pr.left - stage.left;
  const ty = pr.top - stage.top + 46;
  if (p.x > tx - 8) return; // pin sits under the panel — no useful line to draw

  svg.innerHTML = `
    <line x1="${p.x}" y1="${p.y}" x2="${tx - 5}" y2="${ty}"
          stroke="#ead9ab" stroke-opacity=".3" stroke-width="1"/>
    <circle cx="${tx - 5}" cy="${ty}" r="2.4" fill="#ead9ab" fill-opacity=".55"/>`;
}

/* -- polygon / radius batch selection ------------------------------------- */

function addVertex(lng, lat) {
  state.drawing.push([lng, lat]);
  map.getSource("verts").setData({
    type: "FeatureCollection",
    features: state.drawing.map((c) => ({
      type: "Feature",
      geometry: { type: "Point", coordinates: c },
      properties: {},
    })),
  });
  if (state.drawing.length >= 2) {
    map.getSource("sel").setData({
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: {},
          geometry: { type: "LineString", coordinates: state.drawing },
        },
      ],
    });
  }
}

function closePolygon() {
  if (state.drawing.length < 3) return;
  const ring = [...state.drawing, state.drawing[0]];
  commitSelection([ring]);
  state.drawing = [];
  map.getSource("verts").setData(emptyFC());
}

function setRadius(lng, lat, km = 2) {
  const ring = [];
  const dLat = km / 110.574;
  const dLng = km / (111.32 * Math.cos((lat * Math.PI) / 180));
  for (let i = 0; i <= 64; i++) {
    const a = (i / 64) * Math.PI * 2;
    ring.push([lng + dLng * Math.cos(a), lat + dLat * Math.sin(a)]);
  }
  commitSelection([ring]);
}

/* Real polyfill of the drawn area — the cell count is genuine, and the
   §6 hard cap of 5,000 cells is enforced here as it will be on the server. */
function commitSelection(coords) {
  map.getSource("sel").setData({
    type: "FeatureCollection",
    features: [{ type: "Feature", properties: {}, geometry: { type: "Polygon", coordinates: coords } }],
  });

  const inside = new Set(state.gridCells);
  let cells = h3.polygonToCells(coords, H3_RES, true).filter((c) => inside.has(c));

  const capped = cells.length > 5000;
  if (capped) cells = cells.slice(0, 5000);
  state.selection = { cells, capped };

  map.getSource("selcells").setData(cellsToFC(cells));
  renderRanked();
  updateCounts();

  if (!$("#drawer").classList.contains("is-open")) openDrawer();
}

/* -------------------------------------------------------------------------
   4. Chrome: zoom readout, scalebar
   ------------------------------------------------------------------------- */

function updateZoomReadout() {
  $("#zoom-readout").textContent = "z" + map.getZoom().toFixed(1);
}

function updateScalebar() {
  const y = map.getCanvas().clientHeight / 2;
  const a = map.unproject([0, y]);
  const b = map.unproject([100, y]);
  const mPerPx = a.distanceTo(b) / 100;
  const targets = [0.1, 0.2, 0.5, 1, 2, 5, 10, 20, 50, 100];
  const maxKm = (mPerPx * 110) / 1000;
  const km = targets.reduce((p, t) => (t <= maxKm ? t : p), targets[0]);
  $("#scale-txt").textContent = km < 1 ? `${km * 1000} m` : `${km} km`;
  $("#scale-bar").style.width = Math.round((km * 1000) / mPerPx) + "px";
}

/* -------------------------------------------------------------------------
   5. Layers panel + legend
   ------------------------------------------------------------------------- */

function renderLayers() {
  const host = $("#layers-list");
  host.innerHTML = "";
  for (const l of LAYERS) {
    const on = state.layers[l.id];
    const row = el("div", "row" + (on ? " is-on" : ""));
    row.innerHTML = `
      <span class="cb"><svg width="10" height="10" viewBox="0 0 24 24"><use href="#i-check"/></svg></span>
      <span class="row-label">${l.name}</span>
      <span class="badge${l.live ? " is-live" : l.badge === "pending" ? " is-pending" : ""}">${l.badge}</span>
      <input class="row-op thin" type="range" min="10" max="100" value="${on ? 100 : 60}"
             aria-label="${l.name} opacity" style="--pct:100%">`;

    row.addEventListener("click", (e) => {
      if (e.target.type === "range") return;
      state.layers[l.id] = !state.layers[l.id];
      if (state.layers[l.id] && l.legend) state.legend = l.legend;
      applyLayerVisibility();
      renderLayers();
      renderLegend();
      updateCounts();
    });
    host.appendChild(row);
  }
}

function applyLayerVisibility() {
  const v = state.layers.grid ? "visible" : "none";
  for (const id of ["grid-fill", "grid-line"]) {
    if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", v);
  }
}

const RAMP = ["--seq-1", "--seq-2", "--seq-3", "--seq-4", "--seq-5", "--seq-6"];

function renderLegend() {
  const host = $("#legend");
  const key = (c, label, dot) =>
    `<span class="legend-key" style="--c:var(${c})"><i class="${dot ? "is-dot" : ""}"></i>${label}</span>`;

  const defs = {
    grid: () => `
      <div class="legend-hd"><span class="eyebrow">H3 grid</span></div>
      <div class="legend-keys">
        ${key("--hair-2", "Cell boundary")}
        ${key("--accent", "Hovered cell")}
      </div>
      <div class="legend-note">
        Res-8 cells, <b style="color:var(--ink-2)">${fmt(state.gridCells.length)}</b>
        over Travis County · ~0.74 km² each. Unfilled: no scores computed yet.
      </div>`,

    seq: () => `
      <div class="legend-hd"><span class="eyebrow">Site readiness</span>
        <span class="badge is-pending">0–100</span></div>
      <div class="legend-ramp">${RAMP.map((c) => `<i style="--c:var(${c})"></i>`).join("")}</div>
      <div class="legend-scale">
        ${sk(16, 8, 0)}${sk(16, 8, 0.1)}${sk(16, 8, 0.2)}${sk(16, 8, 0.3)}
      </div>
      <div class="legend-note">
        Sequential, one hue, dark→light so strong sites read brightest against
        the basemap. Bin edges await the first batch score.
      </div>`,

    div: () => `
      <div class="legend-hd"><span class="eyebrow">Getis-Ord Gi*</span>
        <span class="badge is-pending">z-score</span></div>
      <div class="legend-ramp">
        <i style="--c:var(--div-cold)"></i><i style="--c:#2f5f8e"></i>
        <i style="--c:var(--div-mid)"></i><i style="--c:#9a5252"></i>
        <i style="--c:var(--div-hot)"></i>
      </div>
      <div class="legend-scale"><span>Cold spot</span><span>0</span><span>Hot spot</span></div>
      <div class="legend-note">
        Diverging with a neutral midpoint, so "no clustering" reads as nothing.
        Significance thresholds pending.
      </div>`,

    cat: () => `
      <div class="legend-hd"><span class="eyebrow">POI class</span></div>
      <div class="legend-keys">
        ${key("--cat-1", "Competitors", 1)}
        ${key("--cat-2", "Complementary", 1)}
        ${key("--cat-3", "Anchor tenants", 1)}
      </div>
      <div class="legend-note">
        Three classes, not one signed axis — complementary and anchor
        businesses score monotonically, competitors on an inverted-U.
      </div>`,

    zoning: () => `
      <div class="legend-hd"><span class="eyebrow">Zone class</span></div>
      <div class="legend-keys">
        ${key("--cat-1", "Commercial")}
        ${key("--cat-2", "Industrial")}
        ${key("--cat-3", "Residential")}
        ${key("--cat-other", "Other / unzoned")}
      </div>
      <div class="legend-note">
        Three saturated classes plus a neutral tail — the ceiling for a fill
        map that stays separable under colour-vision deficiency.
      </div>`,

    flood: () => `
      <div class="legend-hd"><span class="eyebrow">FEMA flood zone</span></div>
      <div class="legend-keys">
        ${key("--seq-2", "SFHA · 100-yr")}
        ${key("--seq-4", "500-yr")}
        ${key("--seq-6", "Zone X")}
      </div>
      <div class="legend-note">
        Ordered, so one hue in three steps. SFHA is also a hard constraint in
        every preset.
      </div>`,

    aqi: () => `
      <div class="legend-hd"><span class="eyebrow">Interpolated AQI</span>
        <span class="badge is-pending">GeoTIFF</span></div>
      <div class="legend-ramp">${RAMP.slice()
        .reverse()
        .map((c) => `<i style="--c:var(${c})"></i>`)
        .join("")}</div>
      <div class="legend-scale"><span>Good</span><span>Unhealthy</span></div>
      <div class="legend-note">
        IDW-interpolated from EPA AQS points, read back with rasterio during
        scoring. Low default weight.
      </div>`,
  };

  host.innerHTML = (defs[state.legend] || defs.grid)();
}

function updateCounts() {
  const on = Object.values(state.layers).filter(Boolean).length;
  $("#layer-count").textContent = `${on} / ${LAYERS.length} on`;

  const n = state.selection ? state.selection.cells.length : 0;
  $("#handle-counts").textContent = n
    ? `${fmt(n)} cells · 3 pinned`
    : "no selection · 3 pinned";
  $("#ranked-count").textContent = n ? fmt(n) : "0";
}

/* -------------------------------------------------------------------------
   6. Weights + presets
   ------------------------------------------------------------------------- */

function renderWeights() {
  const host = $("#w-list");
  host.innerHTML = "";
  for (const { k, name } of LAYER_KEYS) {
    const v = state.weights[k];
    const item = el("div", "w-item");
    item.innerHTML = `
      <span class="w-name">${name}</span>
      <span class="w-val num" data-val="${k}">${v}</span>
      <span class="w-track">
        <input type="range" min="0" max="60" value="${v}" data-w="${k}"
               aria-label="${name} weight" style="--pct:${(v / 60) * 100}%">
      </span>`;
    host.appendChild(item);
  }

  $$("#w-list input[type=range]").forEach((input) => {
    input.addEventListener("input", () => {
      const k = input.dataset.w;
      state.weights[k] = +input.value;
      input.style.setProperty("--pct", (input.value / 60) * 100 + "%");
      $(`[data-val="${k}"]`).textContent = input.value;
      setModified(true);
      renderWaterfall();
    });
  });
}

function setModified(on) {
  state.modified = on;
  $("#preset-state").classList.toggle("is-modified", on);
  $("#reset-weights").disabled = !on;
}

function applyPreset(id) {
  state.preset = id;
  state.weights = { ...PRESETS[id].w };
  setModified(false);
  $("#preset-name").textContent = PRESETS[id].label;
  $$("#presets button").forEach((b) =>
    b.classList.toggle("is-on", b.dataset.preset === id)
  );
  $("#cons-head").textContent = `Hard constraints · ${PRESETS[id].label.toLowerCase()}`;
  renderWeights();
  renderWaterfall();
  renderConstraints();
}

/* -------------------------------------------------------------------------
   7. Score panel content
   ------------------------------------------------------------------------- */

/* Waterfall. Bar WIDTHS are seeded-random geometry so the form is legible;
   they carry no value, and every figure beside them is a skeleton. Bar length
   does track the layer's weight, because the weight is real and user-set. */
function renderWaterfall() {
  const host = $("#waterfall");
  const total = Object.values(state.weights).reduce((a, b) => a + b, 0) || 1;
  _seed = 20260904;

  host.innerHTML =
    LAYER_KEYS.map(({ k, name }, i) => {
      const share = state.weights[k] / total; // real: user-controlled
      const dir = rnd() > 0.42 ? 1 : -1; // placeholder geometry only
      const mag = (0.3 + rnd() * 0.7) * share * 2.4;
      const w = Math.max(3, Math.min(49, mag * 100));
      return `
      <div class="wf-row">
        <span class="wf-name">${name}</span>
        <span class="wf-plot">
          <span class="sk wf-bar ${dir > 0 ? "pos" : "neg"}"
                style="${dir > 0 ? "left:50%" : `right:50%`};width:${w.toFixed(1)}%;--d:${(i * 0.11).toFixed(2)}s"></span>
        </span>
        <span class="wf-val">${sk(20, 7, i * 0.11)}</span>
      </div>`;
    }).join("") +
    `<div class="wf-row wf-axis">
       <span></span>
       <span class="wf-plot"><span class="wf-zero-lbl">metro mean</span></span>
       <span></span>
     </div>
     <div class="wf-foot">
       <div class="kv" style="border:0;padding:0">
         <span class="kv-k" style="color:var(--ink-2)">Composite</span>
         <span class="kv-v">${sk(46, 15, 0.7)}</span>
       </div>
     </div>`;
}

function renderConstraints() {
  const host = $("#cons-list");
  host.innerHTML = PRESETS[state.preset].cons
    .map(
      ([rule, threshold], i) => `
    <div class="cons-item">
      <span class="sk cons-icon" style="--d:${(i * 0.13).toFixed(2)}s"></span>
      <span class="cons-body">
        <span class="cons-rule">${rule} <span class="num">${threshold}</span></span>
        <span class="cons-actual">
          <span class="eyebrow">actual</span>
          ${sk(72, 9, i * 0.13 + 0.06)}
        </span>
      </span>
    </div>`
    )
    .join("");
}

function renderCatchment() {
  $("#catch-body").innerHTML = CATCH_BANDS.map(
    ([mode, band], i) => `
    <tr>
      <td>${mode} <span style="color:var(--ink-4)">·</span> <span class="num">${band}</span></td>
      <td>${sk(58, 9, i * 0.1)}</td>
      <td>${sk(30, 9, i * 0.1 + 0.04)}</td>
      <td>${sk(44, 9, i * 0.1 + 0.08)}</td>
    </tr>`
  ).join("");
}

/* -------------------------------------------------------------------------
   8. Drawer: ranked cells + compare
   ------------------------------------------------------------------------- */

function renderRanked() {
  const body = $("#ranked-body");
  if (!state.selection || !state.selection.cells.length) {
    body.innerHTML = `
      <tr><td colspan="10" style="padding:26px 0;text-align:center;color:var(--ink-4)">
        Draw a polygon or set a radius to batch-score up to 5,000 cells.
      </td></tr>`;
    return;
  }

  const cells = state.selection.cells.slice(0, 14);
  body.innerHTML =
    cells
      .map(
        (c, i) => `
    <tr class="rank-row" data-cell="${c}">
      <td>${i + 1}</td>
      <td class="cell-id">${c}</td>
      <td>${sk(30, 9, i * 0.05)}</td>
      <td>${sk(22, 9, i * 0.05 + 0.02)}</td>
      <td>${sk(22, 9, i * 0.05 + 0.04)}</td>
      <td>${sk(22, 9, i * 0.05 + 0.06)}</td>
      <td>${sk(22, 9, i * 0.05 + 0.08)}</td>
      <td>${sk(22, 9, i * 0.05 + 0.1)}</td>
      <td>${sk(22, 9, i * 0.05 + 0.12)}</td>
      <td>${sk(42, 9, i * 0.05 + 0.14)}</td>
    </tr>`
      )
      .join("") +
    (state.selection.cells.length > 14
      ? `<tr><td colspan="10" style="padding:11px 0;color:var(--ink-4);text-align:center">
           ${fmt(state.selection.cells.length - 14)} more cells · ranking pending the batch score
         </td></tr>`
      : "") +
    (state.selection.capped
      ? `<tr><td colspan="10" style="padding:9px 0;color:var(--warn);text-align:center">
           Selection exceeded the 5,000-cell cap and was truncated.
         </td></tr>`
      : "");

  // Row hover flashes the corresponding hex on the map.
  $$("#ranked-body .rank-row").forEach((tr) => {
    const id = idFor(tr.dataset.cell);
    tr.addEventListener("mouseenter", () =>
      map.setFeatureState({ source: "grid", id }, { hot: true })
    );
    tr.addEventListener("mouseleave", () =>
      map.setFeatureState({ source: "grid", id }, { hot: false })
    );
    tr.addEventListener("click", () => {
      const [lat, lng] = h3.cellToLatLng(tr.dataset.cell);
      map.easeTo({ center: [lng, lat], zoom: Math.max(map.getZoom(), 12.5) });
      setPin(lng, lat);
    });
  });
}

function renderCompare() {
  const pinned = [
    { name: "Candidate 04", c: "--cat-1" },
    { name: "Candidate 07", c: "--cat-2" },
    { name: "Candidate 11", c: "--cat-3" },
  ];
  const rows = [
    "Composite",
    ...LAYER_KEYS.map((l) => l.name),
    "Catchment · car 20 min",
  ];

  const head =
    `<div class="cmp-k" style="color:var(--ink-4)">Up to 4 sites</div>` +
    pinned
      .map(
        (p) =>
          `<div class="cmp-hd" style="--c:var(${p.c})"><span class="dot"></span><span>${p.name}</span></div>`
      )
      .join("") +
    `<div class="cmp-empty">
       <svg width="13" height="13" viewBox="0 0 24 24" style="opacity:.5"><use href="#i-plus"/></svg>
       Pin a 4th
     </div>` +
    `<div class="cmp-row-sep"></div>`;

  const body = rows
    .map(
      (r, i) =>
        `<div class="cmp-k"${i === 0 ? ' style="color:var(--ink-2);font-weight:550"' : ""}>${r}</div>` +
        pinned.map((_, j) => sk("100%", i === 0 ? 15 : 9, (i * 3 + j) * 0.045)).join("") +
        `<div></div>` +
        (i < rows.length - 1 ? `<div class="cmp-row-sep"></div>` : "")
    )
    .join("");

  $("#cmp-grid").innerHTML = head + body;
}

/* -------------------------------------------------------------------------
   9. Generic chrome wiring
   ------------------------------------------------------------------------- */

function openDrawer() {
  const d = $("#drawer");
  d.classList.add("is-open");
  requestAnimationFrame(() =>
    $("#stage").style.setProperty("--drawer-h", $(".drawer-body").offsetHeight + "px")
  );
}
function closeDrawer() {
  $("#drawer").classList.remove("is-open");
  $("#stage").style.setProperty("--drawer-h", "40px");
}

function wireChrome() {
  // collapsible cards
  $$("[data-collapse]").forEach((b) =>
    b.addEventListener("click", () => b.closest(".card").classList.toggle("is-collapsed"))
  );

  // score panel tabs
  $$("#sp-tabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$("#sp-tabs .tab").forEach((x) => x.classList.remove("is-on"));
      t.classList.add("is-on");
      $$("#score-panel .pane").forEach((p) =>
        p.classList.toggle("is-on", p.dataset.pane === t.dataset.pane)
      );
    })
  );

  // drawer tabs
  $$("#drawer-tabs .tab").forEach((t) =>
    t.addEventListener("click", () => {
      $$("#drawer-tabs .tab").forEach((x) => x.classList.remove("is-on"));
      t.classList.add("is-on");
      $$(".drawer-scroll .pane").forEach((p) =>
        p.classList.toggle("is-on", p.dataset.dpane === t.dataset.dpane)
      );
    })
  );

  $("#drawer-open").addEventListener("click", openDrawer);
  $("#drawer-close").addEventListener("click", closeDrawer);

  // presets
  $$("#presets button").forEach((b) =>
    b.addEventListener("click", () => applyPreset(b.dataset.preset))
  );
  $("#reset-weights").addEventListener("click", () => applyPreset(state.preset));

  // draw tools
  $$("#tools button").forEach((b) =>
    b.addEventListener("click", () => {
      $$("#tools button").forEach((x) => x.classList.remove("is-on"));
      b.classList.add("is-on");
      state.tool = b.dataset.tool;
      state.drawing = [];
      if (map.isStyleLoaded() && map.getSource("verts"))
        map.getSource("verts").setData(emptyFC());
      map.getCanvas().style.cursor = state.tool === "pin" ? "" : "crosshair";
    })
  );

  // view controls
  $("#zoom-in").addEventListener("click", () => map.zoomIn());
  $("#zoom-out").addEventListener("click", () => map.zoomOut());
  $("#reset-view").addEventListener("click", () =>
    map.easeTo({ center: [AUSTIN.lng, AUSTIN.lat], zoom: 10.4 })
  );

  // close score panel
  $("#score-panel .close-btn").addEventListener("click", () => {
    $("#score-panel").style.display = "none";
    $("#leader").innerHTML = "";
    if (pinMarker) {
      pinMarker.remove();
      pinMarker = null;
    }
    state.pin = null;
  });

  // copy coords
  $(".copy-btn").addEventListener("click", () => {
    if (state.pin) navigator.clipboard?.writeText(`${state.pin.lat}, ${state.pin.lng}`);
  });

  window.addEventListener("resize", drawLeader);
}

/* -------------------------------------------------------------------------
   10. Boot
   ------------------------------------------------------------------------- */

// The constraints pane header is re-labelled per preset, so tag it.
$('[data-pane="constraints"] .eyebrow').id = "cons-head";

$("#stage").style.setProperty("--drawer-h", "40px");
renderLayers();
renderLegend();
renderWeights();
renderWaterfall();
renderConstraints();
renderCatchment();
renderRanked();
renderCompare();
updateCounts();
wireChrome();
