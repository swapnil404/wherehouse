# Wherehouse — Technical Specification

**GeoSpatial Site Readiness Analyzer**
Problem Statement 7 — Geo Spatial Analytics & Site Detection

| | |
|---|---|
| **Team** | Vaid — Frontend · Megha — ML / Spatial Analytics · Swapnil — Backend / Data |
| **Metro area** | Austin, TX (Travis County) |
| **Version** | v3 · 2026-09-04 |
| **Structure** | Phased by dependency, not by calendar |

---

## 1. Summary

Wherehouse answers one question: **"How good is this location for what I want to build?"**

A user drops a pin (or draws a polygon) on a map of the Austin metro. Wherehouse returns a **Site Readiness Score from 0–100**, an explainable breakdown of *why*, a side-by-side comparison against other candidates, and a catchment analysis of how many people can actually reach it. Layer weights are configurable, so the same engine scores a coffee shop, a distribution warehouse, and an EV charging station differently.

The status quo is analysts stitching together QGIS exports, spreadsheets, and intuition over weeks. Wherehouse compresses that to a sub-second query with a defensible number attached.

---

## 2. Stack

```bash
bun create better-t-stack@latest wherehouse --frontend tanstack-start --backend self --runtime none --api trpc --auth better-auth --payments none --database postgres --orm drizzle --db-setup none --package-manager bun --git --web-deploy cloudflare --server-deploy none --install --addons turborepo --examples none
```

| Concern | Choice |
|---|---|
| Monorepo | Turborepo + Bun workspaces |
| Frontend | TanStack Start (React 19, SSR) |
| Backend | `--backend self` — server functions inside the TanStack Start app |
| API | tRPC |
| Auth | Better Auth — email/password login + signup |
| Database | Neon Postgres + PostGIS, reached from Workers via Cloudflare Hyperdrive |
| ORM | Drizzle (app + auth tables only — §5.4) |
| Deploy | Cloudflare Workers |
| Map | MapLibre GL + deck.gl |
| Tiles | PMTiles in Cloudflare R2, read client-side over HTTP range requests |
| **Geo/ML sidecar** | **FastAPI + GeoPandas, Shapely, H3, scikit-learn, rasterio — on Render** |
| Routing | OSRM, run offline only during precompute (§7) |

### 2.1 The one thing the stack doesn't cover

The brief mandates *Python (GeoPandas, Shapely, H3, scikit-learn)* and *FastAPI*. Better-T-Stack is entirely TypeScript. We resolve this with a **Python FastAPI sidecar** (`apps/geo`) owning every operation that needs the Python geospatial toolchain. The TypeScript app owns UI, auth, saved user data, and fast read-through of precomputed results.

Both halves talk to the same Neon database. The split is by *capability*:

- **TypeScript can't** do Shapely geometry ops, H3 polyfill at scale, sklearn DBSCAN, Getis-Ord Gi*, or read GeoTIFFs → sidecar.
- **The sidecar shouldn't** handle sessions, saved sites, or serve the UI → TypeScript.

This is a real distributed system, so §3.1–3.2 are about making the seam not hurt.

---

## 3. Architecture

```
BROWSER — TanStack Start + MapLibre + deck.gl                    (Vaid)
  map canvas · score panel · weight editor · compare tray
      │ tRPC                                    └── PMTiles ────┐
      ▼                                                        │
CLOUDFLARE WORKERS — TanStack Start server                (Swapnil)
  tRPC routers · Better Auth · Drizzle · raw SQL · sidecar client
      │ Hyperdrive                    │ HTTPS + bearer          │
      ▼                               ▼                        │
NEON POSTGRES + POSTGIS  ◄────  RENDER — FastAPI          (Megha)
  h3_cells · cell_reach          /score /hotspots /catchment
  layer tables · auth · app      GeoPandas · H3 · sklearn       │
                                                               │
CLOUDFLARE R2 — *.pmtiles (roads, zoning, flood, buildings) ────┘

OFFLINE, NEVER DEPLOYED                                   (Swapnil)
  ingest → PostGIS  ·  OSRM Docker → cell_reach  ·  tippecanoe → R2
```

### 3.1 Contract between TypeScript and Python

**The sidecar's OpenAPI schema is the single source of truth.** `bun run gen:geo` generates a typed client from it; tRPC procedures wrap that client and never re-declare response shapes. A change by Megha breaks Swapnil's typecheck immediately rather than at runtime in the demo. Keep `gen:geo` in CI.

Until the sidecar is real it serves fixtures for every endpoint, so nobody is ever blocked on anybody. Full contract in [`spec/api-contract.md`](spec/api-contract.md).

### 3.2 Render cold starts — the main operational risk

Render's free tier spins down after ~15 minutes idle, cold-starting in ~50 seconds. That would destroy a live demo. Three mitigations, in order of importance:

1. **Architectural — the sidecar is not on the critical path for first paint.** The opening view (heatmap, hot-spots, layer overlays, isochrones) reads entirely from precomputed Postgres tables and R2 tiles. A completely cold sidecar still gives a fully rendered, explorable map. Only *ad-hoc* work — scoring an arbitrary point, batch-scoring a custom polygon, re-clustering — touches Python. **Guard this property as you build; it's easy to accidentally route something onto the critical path.**
2. **Warmup on app load** — the root route fires a non-blocking `/health`. A request landing mid-spin-up shows a "warming up analysis engine" toast rather than looking broken.
3. **Cloudflare Cron Trigger** pings `/health` every 10 minutes.

Render's free tier also caps at **512 MB RAM**. The sidecar must query PostGIS for the rows it needs, never load metro-wide GeoDataFrames. *Any `read_postgis` without a `WHERE` clause is a bug* — make it a review rule.

### 3.3 Configuration

See [`spec/env.example`](spec/env.example). The sidecar is a public URL, so the Worker authenticates every request with a shared bearer token — it is not a public API.

---

## 4. Scope

### 4.1 Assumptions

| # | Assumption | Rationale |
|---|---|---|
| A1 | **Austin, TX** — all layers clipped to this bbox | Census/TIGER, FEMA and EPA are US-only; Austin has all of them plus clean OSM and open city zoning. Swapping metros is a config change |
| A2 | **Data ingested offline and static** — no source APIs at request time | Live fetches during a demo are how demos die |
| A3 | **Three presets, equally tuned** — Retail, Warehouse, EV Charging | Configurability is an explicit evaluation criterion; three presets prove it in one gesture |
| A4 | **Validation = 30 sites labeled by all three of us** against a written rubric, plus ~10 known-good real locations and ~10 deliberately bad points | The brief says "expert-labeled". We aren't domain experts, so we use a documented rubric and report inter-rater agreement rather than overclaiming |
| A5 | **H3 resolution 8** (~0.74 km²/cell). Austin ≈ 3,500 cells | Small enough to fully precompute, fine enough to be useful |

### 4.2 Out of scope

Teams/orgs/sharing (auth is login+signup only, for persisting saved sites) · payments · real-time updates · multiple metros · **transit isochrones** (needs GTFS + OpenTripPlanner — car and walk only; the brief mentions transit and we knowingly meet half of it, see §11) · end-user upload of Shapefiles/GeoTIFFs (those formats are *read by the ingestion pipeline*; the UI takes GeoJSON/WKT) · mobile layout.

### 4.3 Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| Render cold start kills a live interaction | High | High | §3.2 — sidecar off the critical path |
| **Neon free tier is 0.5 GB**; raw OSM geometry exceeds it | High | High | §5.3 — DB holds analytics, R2 holds cartography |
| Workers CPU limits on batch scoring | Med | Med | Runtime reads precomputed columns; heavy compute in sidecar; cap batches at 5,000 cells |
| Drizzle can't model PostGIS polygons | Certain | Low | Designed around — §5.4 |
| deck.gl breaks under TanStack Start SSR | High | Med | Client-only boundary + `React.lazy`. Do it on the first commit, not after debugging `window is not defined` |
| OSRM reachability matrix takes hours | Med | Med | Chunk, checkpoint, run overnight. Offline and one-time — never blocks the app |
| Hyperdrive + PostGIS type quirks over the pooler | Med | Med | Always return `ST_AsGeoJSON(...)::text`; never ship raw WKB |
| TS and Python scoring logic diverge | Med | High | **Scoring math exists in exactly one place — Python.** TS only recomputes a weighted sum from sidecar-supplied subscores (§8.3) |

---

## 5. Data layers

Five is the requirement; we ship six.

| # | Layer | Source | Format in | Table |
|---|---|---|---|---|
| 1 | Demographics | Census ACS 5-yr + TIGER tracts | Shapefile | `census_tracts` |
| 2 | Transportation | OpenStreetMap (Geofabrik Texas) | PBF → GeoJSON | `roads` |
| 3 | Points of interest | OSM POIs + synthetic competitor set | GeoJSON | `poi` |
| 4 | Land use & zoning | City of Austin open data + OSM buildings | Shapefile | `zoning` |
| 5 | Flood / hazard | FEMA National Flood Hazard Layer | Shapefile | `flood_zones` |
| 6 | Air quality | EPA AQS daily summaries | CSV + WKT → **GeoTIFF** | `air_quality` |

**Format coverage, honestly accounted for:** *GeoJSON* — POI and all API geometry I/O. *Shapefile* — census, zoning, FEMA via GeoPandas/Fiona. *GeoTIFF* — AQI is IDW-interpolated to a raster, written as GeoTIFF, read back with `rasterio` during scoring; a genuine read path, not a checkbox. *WKT* — EPA point input, plus `areaWkt` accepted on `score.batch` and `hotspots.compute`.

Full DDL in [`spec/schema.sql`](spec/schema.sql).

### 5.1 Synthetic competitor dataset

Generated, not scraped — reproducible and license-clean. Competitor points are placed with a clustered point process (Thomas) weighted toward commercial zoning and population density, so placement looks like real retail siting rather than uniform noise. Seeded RNG, output committed as GeoJSON so everyone scores identically.

### 5.2 The H3 grid — the backbone

The metro is polyfilled at res 8 and every cell precomputes its demographics, road density and highway distance, competitor/complementary/anchor counts at several radii, dominant zone class, flood status, AQI, and per-layer subscores per preset.

Heatmaps, hot-spot detection, batch scoring and catchment all read this one table. Live point scoring reads the containing cell for expensive aggregates and computes only the distance-sensitive terms fresh.

### 5.3 Storage discipline: analytics in Postgres, cartography in R2

Neon's free tier is 0.5 GB and raw Austin OSM geometry alone can exceed it. So:

- **Postgres holds analysis-ready data** — the H3 table, tract polygons simplified to ~10 m tolerance, POI points, reachability. Roads are a simplified network for distance queries only.
- **R2 holds display geometry** — `tippecanoe` builds vector tiles for roads, zoning, flood and buildings; `pmtiles` packs them into single files in a public bucket, read client-side via the `pmtiles://` protocol.
- **Building footprints never enter Postgres.** They're aggregated to per-hex area at ingest and rendered only from tiles.

This started as a cost workaround, but serving cartography from tiles rather than GeoJSON endpoints is what makes the map fast and deletes a whole class of backend endpoints. Keep it either way.

### 5.4 Drizzle ↔ PostGIS boundary

Drizzle has no representation for PostGIS polygons. Rather than fight it:

| Owned by | Tables | Migrations |
|---|---|---|
| **Drizzle** | Better Auth tables + `project`, `saved_site`, `comparison_set` | `drizzle-kit` |
| **Raw SQL** | `census_tracts`, `roads`, `poi`, `zoning`, `flood_zones`, `air_quality`, `h3_cells`, `cell_reach` | `pipeline/sql/`, applied by the ingest pipeline |

Geo tables are **not** declared in the Drizzle schema — `drizzle-kit push` would try to drop columns it can't model. TypeScript reads them via `db.execute(sql\`...\`)` with geometry cast to GeoJSON text.

One design note worth keeping: `saved_site.score_snapshot` records what a site scored *under the weights in force at save time*. Without it, a user's saved list silently rewrites itself whenever the model changes and their notes stop matching reality. See [`spec/schema.drizzle.ts`](spec/schema.drizzle.ts).

---

## 6. Sidecar API

Owned by Megha. Five endpoints, all under `/v1` with bearer auth:

| Endpoint | Purpose |
|---|---|
| `POST /v1/score` | Composite score + weight-independent per-layer breakdown + constraint results for one point |
| `POST /v1/score/batch` | Same for a point list, GeoJSON area, or WKT area. Hard cap 5,000 cells |
| `POST /v1/hotspots` | Getis-Ord Gi*, DBSCAN, or H3 binning; returns classified cells, clusters, and underserved areas |
| `POST /v1/catchment` | Isochrone bands + catchment population, read from precomputed `cell_reach` |
| `GET /v1/presets` · `/v1/validate/report` · `/health` | Config, validation metrics, warmup target |

Request/response shapes, error codes, and the reasoning behind weight-independent subscores are in [`spec/api-contract.md`](spec/api-contract.md).

---

## 7. Routing and catchment — hex reachability

Precompute owned by Swapnil, consumed by Megha and Vaid.

OSRM can't run on Cloudflare, and calling a hosted routing API at request time adds a network dependency to the demo. So routing is **fully precomputed offline** — and the H3 grid makes this unusually clean.

**Instead of contouring polygons, an isochrone is a set of hexes.**

Boot OSRM locally in Docker on the Texas extract (`--max-table-size 4000`, car and foot profiles). For each of the ~3,500 cell centroids, request a duration matrix to all other centroids — chunked and checkpointed to disk. For each source, mode, and band (car 10/20/30, foot 10/20), keep the destinations under the threshold and write them to `cell_reach`. That's **~17,500 rows total.**

What this buys:

- **Isochrone display** — `ST_Union` the destination cell boundaries into a clean polygon band.
- **Catchment population** — `SUM(pop)` over destination cells. Exact against our own grid, with none of the area-weighted interpolation error you get from intersecting an isochrone polygon with census tracts. This is *more* accurate than the naive approach, not less.
- **Zero runtime routing dependency.** Works on Workers, works offline, works when Render is cold.

**Approximations, stated in the UI:** a point that isn't a cell centroid snaps to its containing cell (worst case ~460 m at res 8, roughly 30 seconds of driving), and durations are free-flow OSRM with no traffic or time-of-day variation. Both are acceptable for site *screening*, which is what this tool is for.

---

## 8. Scoring model

Owned by Megha. The analytical core, and the thing judges will poke hardest.

### 8.1 Structure

```
1. Hard constraints → if violated, eligible=false (score still reported, with reasons)
2. Layer subscores  → s_i ∈ [0,100], weight-independent
3. Composite        → S = Σ(w_i · s_i) / Σ(w_i)
4. Explanation      → contributions, drivers, detractors, constraint status
```

We report the composite even when constraints fail. Silently zeroing is unexplainable, and explainability is an evaluation criterion.

### 8.2 Distance decay

Three functions, all returning `[0,1]`, selectable per feature: **exponential** `exp(-d/λ)` for highway access (fast falloff, then flat), **Gaussian** `exp(-d²/2σ²)` for anchor tenants (a plateau of "close enough", then a cliff), and **linear cutoff** `max(0, 1-d/d_max)` as the interpretable default for anything untuned. Parameters live per-layer per-preset — a warehouse cares about highways at a 10 km scale, a coffee shop at 500 m.

### 8.3 Competitive density — the inverted-U

Zero competitors can mean an untapped market *or* a market already tried and abandoned. Too many means saturation. The sweet spot is between — the classic retail agglomeration effect, and the most interesting modeling in the project:

```
s_competition(n) = 100 · exp( -(n - n*)² / (2σ_c²) )
```

Retail peaks at 3 competitors within 1 km; warehouse peaks at 0 within 5 km (effectively monotonic decreasing — no agglomeration benefit for logistics); EV charging peaks at 1 within 2 km. Complementary businesses and anchor tenants are **separate features** scoring monotonically positive with decay, not the same feature with a sign flip. Tuned values in [`spec/presets.yaml`](spec/presets.yaml).

**Client-side re-scoring.** Because subscores are weight-independent, dragging a weight slider needs no server call — the frontend recomputes `Σ(w_i·s_i)/Σ(w_i)` over the cached subscores of every visible hex and recolors the deck.gl layer. Sub-100 ms, and the scoring *math* still lives only in Python. TypeScript performs one weighted average and nothing else; that constraint is what keeps two languages from drifting into two different models.

### 8.4 Layer subscores

| Layer | Method |
|---|---|
| Demographics | Percentile rank of pop density × income band-fit × age band-fit. Income uses a *target band*, not "more is better" — a discount retailer wants median income, not maximum |
| Transportation | Blend of road-density percentile and decayed highway distance; warehouse shifts weight toward the highway term |
| POI | Weighted blend of the competitive inverted-U, complementary density, and anchor proximity |
| Zoning | Categorical lookup per use case — retail favours commercial, warehouse inverts it toward industrial |
| Flood | In SFHA → 0 · 500-yr zone → ~55 · Zone X → 100. Also a hard constraint in most presets |
| Air quality | Linear inverse of interpolated AQI, clamped. Low default weight |

**Normalization:** every subscore is percentile-ranked against the full H3 grid before weighting, so "80" always means "better than 80% of the metro." Mixing raw units across layers is the fastest route to a meaningless composite.

### 8.5 Hard constraints

Declared per preset as `{feature, op, value}` and evaluated boolean — minimum population within 5 km, not in a flood zone, allowed zone classes, maximum highway distance. Every constraint returns its actual value and pass/fail, so the UI can say "failed: population within 5 km is 18,400, needs 25,000" and the tool explains itself.

### 8.6 Validation

- **Spearman ρ** between model score and mean expert label across 30 sites. Target ≥ 0.7.
- **Precision@10** — overlap between model top-10 and expert top-10.
- **Sanity separation** — mean score of known-good real sites vs. deliberately bad points. Target gap > 35. A small gap means the model is broken regardless of what ρ says.
- **Inter-rater agreement** (Krippendorff's α) across the three of us. Reporting this converts our weakest claim into a defensible one.
- **Sensitivity analysis** — ±20% weight perturbation, reporting rank stability. Shows the model isn't balanced on a knife edge.

Labels are assigned against a written rubric **before anyone sees model output**. Labeling after seeing scores makes the validation worthless, and we shouldn't claim it.

---

## 9. Frontend

Owned by Vaid. TanStack Start + MapLibre GL + deck.gl, zustand, Tailwind + shadcn/ui.

**SSR caveat, handle first:** deck.gl and MapLibre touch `window` at import time. The whole map tree must be lazy-loaded behind a client-only boundary. Cheap on the first commit, miserable to retrofit.

```
┌────────────────────────────────────────────────────────────────┐
│ Wherehouse  [Retail][Warehouse][EV]        [Validation] [Login]│
├──────────┬─────────────────────────────────────┬───────────────┤
│ LAYERS   │                                     │  SITE SCORE   │
│ ☑ Heatmap│           MAP CANVAS                │    78.4  B+   │
│ ☑ Hotspot│        (click to score)             │  ▸ Breakdown  │
│ ☐ Roads  │                                     │    waterfall  │
│ ☑ Compet.│                                     │  ▸ Constraints│
│ ☐ Zoning │                                     │  ▸ Catchment  │
│ ☐ Flood  │                                     │  ▸ Drivers    │
│ ☐ AQI    │                                     │               │
│ WEIGHTS  │  [✏ polygon] [◎ radius] [↻ reset]   │  [+ Compare]  │
│ ▬▬▬●▬ 35 │                                     │  [⤓ Export]   │
├──────────┴─────────────────────────────────────┴───────────────┤
│ COMPARE   Site A 78.4 │ Site B 71.2 │ Site C 66.9         [×]  │
└────────────────────────────────────────────────────────────────┘
```

**Components.** *MapCanvas* — MapLibre basemap + PMTiles from R2; deck.gl overlays for the score heatmap, Gi* hot/cold with a diverging ramp, POI by category, zoning fill, flood hatch, stacked isochrone bands, and editable draw tools. *LayerPanel* — per-layer toggle and opacity, legend swaps with the active layer. *WeightEditor* — presets plus six sliders, renormalized live, client-side re-score on drag; **watching the heatmap shift as you drag is the best moment in the product, so prioritize making it smooth.** *ScorePanel* — score dial, grade, a **waterfall** of per-layer contributions measured from the metro mean (a plain bar chart is boring; a waterfall shows *why*), constraint checklist, catchment table, plain-English drivers and detractors. *CompareTray* — up to 4 pinned sites with aligned subscore rows and a radar overlay. *SavedSites* — appears when logged in. *Export* — one-page PDF plus GeoJSON of pinned sites; ten lines of code and the thing analysts will actually use. *ValidationPage* — ρ, P@10, separation, α, sensitivity, and the rubric. Showing your own error bars reads as confidence, not weakness.

**Performance targets:** initial map load < 3 s · layer toggle < 100 ms · weight slider recolor < 250 ms (no network) · click → score < 600 ms warm · isochrone render < 500 ms.

---

## 10. Build phases

Dependency-ordered, not calendar-bound. **`bun run dev` must work at the end of every phase**, even with features stubbed.

### Phase 0 — Scaffold and freeze the contract

**Swapnil** — run the scaffold; Neon + PostGIS + Hyperdrive; Better Auth signup/login end to end; Drizzle app tables; tRPC routers returning fixtures; local `docker-compose` with PostGIS + OSRM.
**Megha** — FastAPI skeleton with every endpoint returning fixtures; Dockerfile deployed to Render with `/health` green; decay functions and composite math with unit tests, developed against local GeoJSON.
**Vaid** — map renders Austin; **client-only boundary for deck.gl done properly now**; layer panel and weight sliders on local state; consuming fixtures via tRPC.

*Exit:* OpenAPI frozen, `gen:geo` in CI, signup→login works, map renders, local PostGIS up.

### Phase 1 — Data foundation

**Swapnil** — all six ingest scripts; DDL and GiST indexes; full res-8 grid built; tippecanoe → PMTiles → R2; geometry simplified to stay inside 0.5 GB.
**Megha** — all six layer scorers on real PostGIS; percentile normalization; hard constraints; all three presets tuned.
**Vaid** — real PMTiles layers; draw tools; loading and empty states.

*Exit:* six layers queryable and visible, H3 grid fully populated.

### Phase 2 — Scoring end to end

**Megha** — `/score` and `/score/batch` on real data returning weight-independent subscores; narrative generation.
**Swapnil** — tRPC `score.*` wrapping the generated client; sidecar warmup + cron ping; typed error mapping.
**Vaid** — score panel on real data; waterfall; constraint checklist; **client-side weight re-scoring wired to the heatmap**.

*Exit:* click any point → a real score with a real breakdown, and a weight slider visibly reshapes the map. **Make-or-break phase; everything after is additive.**

### Phase 3 — Spatial analytics and accessibility

**Megha** — Getis-Ord Gi*; DBSCAN on high-score candidates; underserved-area detection; `/catchment` reading `cell_reach`.
**Swapnil** — the full OSRM duration matrix, chunked and checkpointed; `cell_reach` populated for car and foot; tRPC routing endpoints reading straight from Postgres.
**Vaid** — hot-spot layer with diverging ramp; underserved view; isochrone bands + catchment table.

*Exit:* hot-spots, cold-spots and underserved areas render; catchment works for car and walk.

### Phase 4 — Product surface

**Vaid** — compare tray; PDF + GeoJSON export; saved sites UI; polish, legends, empty states, error toasts.
**Swapnil** — `sites` and `presets` routers on `protectedProcedure`; score snapshots on save; response caching; performance pass against §9.
**Megha** — label the 30-site validation set against the rubric, **all three of us independently, before looking at any model output**; run validation; tune weights if results are poor and document what changed and why.

*Exit:* every requirement in §12 is demonstrable.

### Phase 5 — Harden, deploy, document

Feature freeze. Clean-machine test — fresh clone → `bun install` → `bun run dev`, run by someone who didn't write the setup. Deploy both halves and verify the live URL end to end. README with architecture, setup, **data provenance and licenses**, and honest limitations. Model card: what the scoring engine does, validation results, known biases, what it should *not* be used for. Demo rehearsed cold, twice, with screenshots and a fallback recording.

### 10.1 Demo script (7 minutes)

1. **(0:30)** Problem framing — months of analyst time across disconnected tools.
2. **(1:00)** Map loads; six layers toggled on one at a time. The "layers integrated" criterion, made visual.
3. **(1:30)** Click a strong site → 82. Walk the waterfall. Click a nearby weak site → 41 with an explicit flood-zone constraint failure.
4. **(1:30)** Switch Retail → Warehouse. **The heatmap inverts** — downtown goes cold, highway-adjacent industrial goes hot. Same engine, same data, different question. Then drag a slider and watch it move live. This is the configurability criterion in one gesture and the strongest 15 seconds you have; whatever else gets cut, this must work.
5. **(1:00)** Gi* clusters, then underserved areas — "high demand, no supply, nobody is there."
6. **(1:00)** Drop a candidate, 20-minute drive isochrone, catchment population. Pin three, open the compare tray, log in, save the project.
7. **(0:30)** Validation page. Close on: explainable, configurable, and measurably not making the numbers up.

---

## 11. Stretch goals

Only after §12 is green, in priority order:

1. **Transit isochrones** — GTFS via OpenTripPlanner, precomputed into `cell_reach` as `mode='transit'`. The schema already supports it. Closes the one requirement we knowingly half-meet.
2. **What-if optimizer** — given a polygon and preset, return top-N optimal points by refining to res 10.
3. **Multi-site portfolio** — pick K sites maximizing coverage with minimal self-cannibalization.
4. **Score-over-time** — how a site shifts under projected population growth.
5. **LLM site memo** — a narrative paragraph from the structured breakdown. Cheap, demos well, strictly cosmetic; the structured explanation already exists and is what matters.

---

## 12. Requirements traceability

| Brief requirement | Where | Owner |
|---|---|---|
| ≥5 geospatial layers | §5 — six shipped | Swapnil |
| GeoJSON / Shapefile / GeoTIFF / WKT | §5 — all four with real read paths | Swapnil |
| Configurable weights | §8.1, `spec/presets.yaml`, live sliders | Megha / Vaid |
| Distance decay functions | §8.2 | Megha |
| Competitive density analysis | §8.3 — inverted-U | Megha |
| Threshold constraints | §8.5 | Megha |
| Clustering / hot-spots | §6 — Gi*, DBSCAN, H3 binning | Megha |
| Interactive map | §9 | Vaid |
| Click for score breakdown | §9 ScorePanel | Vaid |
| Layer toggles | §9 LayerPanel | Vaid |
| Draw custom polygons | §9 → `score.batch` | Vaid |
| Compare multiple sites | §9 CompareTray | Vaid |
| Export reports | §9 — PDF + GeoJSON | Vaid |
| Routing / isochrones | §7 — precomputed OSRM, car + foot | Swapnil |
| Catchment 10/20/30 min | §6, §7 | Megha / Swapnil |
| Validated vs. expert-labeled sites | §8.6 | Megha |
| Python · GeoPandas · Shapely · H3 · sklearn | `apps/geo`, `pipeline/` | Megha / Swapnil |
| FastAPI | `apps/geo` | Megha |
| PostGIS | §5.4, `spec/schema.sql` | Swapnil |
| Vector tiles + MapLibre | §5.3 — tippecanoe → PMTiles → R2 | Swapnil / Vaid |
| React frontend + map library | §9 — TanStack Start | Vaid |

Every line in the brief maps to a deliverable and an owner. Nothing is unassigned.

---

## 13. Definition of done

- [ ] Fresh clone → `bun install` → `bun run dev` works on a clean machine
- [ ] `wrangler deploy` + Render deploy both live and talking to each other
- [ ] Six layers ingested, queryable, visible on the map
- [ ] Signup → login → save a project and its sites → they persist
- [ ] Clicking any point returns a scored breakdown in < 600 ms warm
- [ ] Three presets produce visibly different heatmaps
- [ ] Weight sliders re-score the visible map in < 250 ms with no network call
- [ ] Hot-spots, cold-spots and underserved areas render
- [ ] Polygon draw → batch score → ranked results
- [ ] Isochrones + catchment population for car and walk
- [ ] Compare tray with ≥3 sites, PDF and GeoJSON export
- [ ] Validation page: ρ, P@10, separation, inter-rater α, sensitivity
- [ ] README + model card + data licenses committed
- [ ] Demo rehearsed cold, twice, end to end
