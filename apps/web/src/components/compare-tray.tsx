import {
  ChevronDownIcon,
  ChevronUpIcon,
  Trash2Icon,
  XIcon,
} from "lucide-react";
import { useEffect, useState } from "react";

import {
  compositeScore,
  SUBSCORE_KEYS,
  SUBSCORE_LABELS,
  type Subscores,
} from "@/lib/cells";
import { COMPARE_COLORS, MAX_COMPARE_SITES } from "@/lib/compare";
import { useMapStore } from "@/stores/map-store";

import { panelSurface } from "./panel-styles";
import SiteExportActions from "./site-export-actions";

const RADAR_CENTER = 64;
const RADAR_RADIUS = 48;
const RADAR_LABELS = ["Resident", "Roads", "Business", "Zoning", "Flood", "Air"] as const;
const RADAR_LABEL_POSITIONS = [
  { x: 64, y: 5, anchor: "middle" },
  { x: 112, y: 35, anchor: "start" },
  { x: 112, y: 98, anchor: "start" },
  { x: 64, y: 127, anchor: "middle" },
  { x: 16, y: 98, anchor: "end" },
  { x: 16, y: 35, anchor: "end" },
] as const;

function radarPoint(index: number, value: number) {
  const angle = (Math.PI * 2 * index) / SUBSCORE_KEYS.length - Math.PI / 2;
  const radius = RADAR_RADIUS * Math.max(0, Math.min(100, value)) / 100;
  return `${RADAR_CENTER + Math.cos(angle) * radius},${RADAR_CENTER + Math.sin(angle) * radius}`;
}

function radarPolygon(subscores: Subscores) {
  return SUBSCORE_KEYS.map((key, index) => radarPoint(index, subscores[key])).join(" ");
}

function gridPolygon(value: number) {
  return SUBSCORE_KEYS.map((_, index) => radarPoint(index, value)).join(" ");
}

/** Session comparison: current scores stay live while the user tunes weights. */
export default function CompareTray() {
  const sites = useMapStore((state) => state.comparisonSites);
  const removeSite = useMapStore((state) => state.removeComparisonSite);
  const clearSites = useMapStore((state) => state.clearComparisonSites);
  const focusCell = useMapStore((state) => state.focusCell);
  const preset = useMapStore((state) => state.preset);
  const presets = useMapStore((state) => state.presets);
  const customWeights = useMapStore((state) => state.customWeights);
  const [expanded, setExpanded] = useState(false);

  useEffect(() => {
    if (sites.length >= 2) setExpanded(true);
  }, [sites.length]);

  if (sites.length === 0) return null;

  const weights = customWeights ?? presets?.[preset] ?? {};
  const scores = sites.map((site) => compositeScore(site.subscores, weights));
  // Grow by one useful data-column at a time instead of reserving room for
  // all four possible sites. The viewport cap keeps the tray usable on small
  // screens, where the table becomes horizontally scrollable.
  const trayWidth = 328 + sites.length * 132;
  const tableMinWidth = 112 + sites.length * 112;

  return (
    <aside
      className={`pointer-events-auto absolute bottom-20 left-1/2 z-20 max-w-[calc(100%-2rem)] -translate-x-1/2 overflow-hidden transition-[width] duration-200 ${panelSurface}`}
      aria-label="Site comparison"
      style={{ width: trayWidth }}
    >
      <div className="flex items-center gap-2 px-3 py-2">
        <button
          className="flex min-w-0 flex-1 items-center gap-2 text-left"
          onClick={() => setExpanded((current) => !current)}
          type="button"
        >
          <span className="text-xs font-medium text-foreground">Compare</span>
          <span className="rounded-full bg-white/10 px-1.5 py-px font-mono text-[10px] text-muted-foreground tabular-nums">
            {sites.length}/{MAX_COMPARE_SITES}
          </span>
          <span className="truncate text-[10px] text-muted-foreground">
            {sites.map((_, index) => `Site ${index + 1}`).join(" · ")}
          </span>
          {expanded ? (
            <ChevronDownIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
          ) : (
            <ChevronUpIcon className="ml-auto size-3.5 shrink-0 text-muted-foreground" />
          )}
        </button>

        <SiteExportActions
          preset={preset}
          sites={sites}
          variant="toolbar"
          weights={weights}
        />

        <button
          aria-label="Clear comparison"
          className="rounded-md p-1 text-muted-foreground transition-colors hover:bg-white/5 hover:text-foreground"
          onClick={clearSites}
          type="button"
        >
          <Trash2Icon className="size-3.5" />
        </button>
      </div>

      {expanded ? (
        <div className="grid max-h-[min(390px,calc(100vh-9rem))] grid-cols-[166px_minmax(0,1fr)] border-t border-border">
          <div className="flex items-center justify-center border-r border-border p-3">
            <svg
              aria-label="Subscore radar comparison"
              className="h-36 w-40 overflow-visible font-sans"
              role="img"
              viewBox="-16 -6 160 140"
            >
              {[25, 50, 75, 100].map((level) => (
                <polygon
                  fill="none"
                  key={level}
                  points={gridPolygon(level)}
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth="0.75"
                />
              ))}
              {SUBSCORE_KEYS.map((_, index) => (
                <line
                  key={index}
                  x1={RADAR_CENTER}
                  x2={radarPoint(index, 100).split(",")[0]}
                  y1={RADAR_CENTER}
                  y2={radarPoint(index, 100).split(",")[1]}
                  stroke="rgba(255,255,255,0.10)"
                  strokeWidth="0.75"
                />
              ))}
              {sites.map((site, index) => (
                <polygon
                  fill={COMPARE_COLORS[index].css}
                  fillOpacity="0.06"
                  key={site.h3_index}
                  points={radarPolygon(site.subscores)}
                  stroke={COMPARE_COLORS[index].css}
                  strokeWidth="1.5"
                />
              ))}
              {RADAR_LABELS.map((label, index) => {
                const position = RADAR_LABEL_POSITIONS[index];
                return (
                  <text
                    aria-hidden="true"
                    fill="rgba(255,255,255,0.52)"
                    fontSize="7.5"
                    key={label}
                    textAnchor={position.anchor}
                    x={position.x}
                    y={position.y}
                  >
                    {label}
                  </text>
                );
              })}
            </svg>
          </div>

          <div className="scrollbar-subtle min-w-0 overflow-x-auto">
            <div
              className="grid"
              style={{
                gridTemplateColumns: `112px repeat(${sites.length}, minmax(112px, 1fr))`,
                minWidth: tableMinWidth,
              }}
            >
              <div className="border-b border-border p-2 text-[10px] uppercase tracking-[0.08em] text-muted-foreground">
                Measure
              </div>
              {sites.map((site, index) => (
                <div className="group relative border-b border-l border-border p-2" key={site.h3_index}>
                  <button
                    className="flex w-full items-center gap-1.5 text-left"
                    onClick={() => focusCell(site.h3_index)}
                    type="button"
                  >
                    <span
                      aria-hidden="true"
                      className="size-2 shrink-0 rounded-[2px]"
                      style={{ backgroundColor: COMPARE_COLORS[index].css }}
                    />
                    <span className="text-[11px] font-medium">Site {index + 1}</span>
                    <span className="ml-auto font-mono text-sm tabular-nums">
                      {scores[index]?.toFixed(1) ?? "-"}
                    </span>
                  </button>
                  <button
                    aria-label={`Remove Site ${index + 1}`}
                    className="absolute top-0.5 right-0.5 rounded-sm p-0.5 text-muted-foreground opacity-0 transition-opacity hover:text-foreground focus:opacity-100 group-hover:opacity-100"
                    onClick={() => removeSite(site.h3_index)}
                    type="button"
                  >
                    <XIcon className="size-3" />
                  </button>
                </div>
              ))}

              {SUBSCORE_KEYS.map((key) => (
                <div className="contents" key={key}>
                  <div className="border-b border-border px-2 py-1.5 text-[10px] text-muted-foreground">
                    {SUBSCORE_LABELS[key]}
                  </div>
                  {sites.map((site) => (
                    <div
                      className="border-b border-l border-border px-2 py-1.5 text-right font-mono text-[11px] tabular-nums"
                      key={`${site.h3_index}-${key}`}
                    >
                      {site.subscores[key].toFixed(1)}
                    </div>
                  ))}
                </div>
              ))}

              <div className="px-2 py-1.5 text-[10px] text-muted-foreground">Rules</div>
              {sites.map((site) => (
                <div
                  className={`border-l border-border px-2 py-1.5 text-right text-[10px] ${
                    site.eligible ? "text-foreground" : "text-accent"
                  }`}
                  key={`${site.h3_index}-rules`}
                >
                  {site.eligible
                    ? "Clear"
                    : `${site.constraints.filter((constraint) => !constraint.pass).length} failed`}
                </div>
              ))}
            </div>
          </div>
        </div>
      ) : null}
    </aside>
  );
}
