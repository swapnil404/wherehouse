import { Checkbox } from "@wherehouse/ui/components/checkbox";
import { Label } from "@wherehouse/ui/components/label";
import { Separator } from "@wherehouse/ui/components/separator";
import { Slider } from "@wherehouse/ui/components/slider";
import { CircleDashedIcon, LayersIcon, PencilLineIcon, ScanIcon } from "lucide-react";

import { GRID_MEASURES } from "@/lib/heatmap-palette";
import { describeStudyArea, type DrawMode } from "@/lib/study-area";
import { LAYER_META, useMapStore, type LayerId } from "@/stores/map-store";

import AnalysisPanel from "./analysis-panel";
import { panelSurface, segment, text } from "./panel-styles";
import SectionLabel from "./section-label";

/**
 * One overlay toggle.
 *
 * The per-layer opacity slider that used to sit under every checked row is
 * gone. Five sliders and five percentages, none of which answer a question
 * anyone has while choosing a site: each layer already ships a considered
 * default opacity from its own spec, and "flood zones at 45%" is a rendering
 * preference, not a decision. The heatmap keeps a fade, because dialling the
 * product's own wash back to read the streets underneath is a real want.
 */
/**
 * What the hexes are coloured by.
 *
 * Nested under the heatmap row rather than added as a seventh checkbox,
 * because these two are not overlays — both paint all 1,021 cells, so as
 * separate toggles they would stack two opaque washes and the reader would
 * have to fade one by hand every time. One checkbox for "show the hexes", one
 * choice for "showing what", and the opacity slider below applies to whichever
 * is on.
 *
 * This is what puts air quality on the map. It is the sixth data layer and the
 * only one with no geometry to tile — it is a per-cell fact, so the hexes are
 * the honest place for it, and the value is already in the heatmap payload.
 */
function MeasurePicker() {
  const gridMeasure = useMapStore((s) => s.gridMeasure);
  const setGridMeasure = useMapStore((s) => s.setGridMeasure);

  return (
    <div className="mt-2 pl-6.5">
      <p className={text.caption}>Colour by</p>
      <div className="mt-1 flex gap-1.5">
        {GRID_MEASURES.map((option) => (
          <button
            key={option.id}
            type="button"
            onClick={() => setGridMeasure(option.id)}
            aria-pressed={gridMeasure === option.id}
            className={`flex-1 px-2 focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none ${segment.base} ${
              gridMeasure === option.id ? segment.active : segment.inactive
            }`}
          >
            {option.label}
          </button>
        ))}
      </div>
    </div>
  );
}

function LayerRow({ id }: { id: LayerId }) {
  const meta = LAYER_META.find((m) => m.id === id)!;
  const layer = useMapStore((s) => s.layers[id]);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const setLayerOpacity = useMapStore((s) => s.setLayerOpacity);

  const disabled = !meta.available;
  const fadeable = id === "heatmap";

  return (
    <div className="py-1">
      <div className="flex items-center gap-2.5">
        <Checkbox
          id={`layer-${id}`}
          checked={layer.visible}
          disabled={disabled}
          onCheckedChange={() => toggleLayer(id)}
        />
        <Label
          htmlFor={`layer-${id}`}
          className={
            disabled
              ? `flex-1 cursor-not-allowed ${text.caption}`
              : `flex-1 cursor-pointer ${text.body}`
          }
        >
          {meta.label}
        </Label>
      </div>

      {disabled ? (
        <p className={`mt-1 flex items-center gap-1 pl-6.5 ${text.hint}`}>
          <CircleDashedIcon className="size-3 shrink-0" />
          {meta.hint}
        </p>
      ) : layer.visible && fadeable ? (
        <>
          <MeasurePicker />
          <div className="mt-2 flex items-center gap-2 pl-6.5">
            <Slider
              aria-label="Heatmap strength"
              value={Math.round(layer.opacity * 100)}
              min={20}
              max={100}
              step={5}
              onValueChange={(value) => {
                if (typeof value === "number") setLayerOpacity(id, value / 100);
              }}
            />
            <span className={`w-8 shrink-0 text-right font-mono ${text.numeric}`}>
              {Math.round(layer.opacity * 100)}%
            </span>
          </div>
        </>
      ) : layer.visible && meta.legend ? (
        /* Only shown while the layer is drawn, so the key covers exactly the
           colors currently on the map. Categories are never identified by
           hue alone. */
        <ul className="mt-1.5 space-y-1 pl-6.5">
          {meta.legend.map((entry) => (
            <li key={entry.label} className="flex items-center gap-2">
              <span
                aria-hidden
                className="size-2.5 shrink-0 rounded-[2px]"
                style={{ backgroundColor: entry.hex }}
              />
              <span className={text.caption}>{entry.label}</span>
            </li>
          ))}
        </ul>
      ) : null}

      {/* A hint on an available layer is a caveat, not a blocker: buildings
          only draw past zoom 13. Shown in both states, so before ticking the
          box it sets the expectation and after ticking it explains an empty
          map. */}
      {!disabled && meta.hint ? (
        <p className={`mt-1 pl-6.5 ${text.hint}`}>{meta.hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Narrow the question to part of the city.
 *
 * These live here, with the layer toggles, because they change what the map
 * draws rather than what a score means — the same rule that put the weight
 * sliders in the results card instead. There is no separate toolbar for them
 * and there should not be: a third floating element would have to dodge the
 * two that already own the top corners.
 *
 * Both tools are armed from here and finished on the map, so arming one
 * closes this card. It sits over the top-left of the map, which is exactly
 * where a shape might need its first corner, and it is the one panel that
 * deliberately survives an outside click — so left open it would be in the
 * way with no obvious way out.
 */
function DrawTools() {
  const drawMode = useMapStore((s) => s.drawMode);
  const studyArea = useMapStore((s) => s.studyArea);
  const setDrawMode = useMapStore((s) => s.setDrawMode);
  const setStudyArea = useMapStore((s) => s.setStudyArea);

  const arm = (mode: DrawMode) => {
    // Pressing the armed tool again puts it away, so the button is its own
    // escape hatch and Escape is not the only way to back out.
    if (drawMode === mode) {
      setDrawMode(null);
      return;
    }
    setDrawMode(mode);
  };

  return (
    <div>
      <div className="flex gap-1.5">
        {(
          [
            { mode: "polygon", label: "Draw a shape", Icon: PencilLineIcon },
            { mode: "radius", label: "Circle a point", Icon: ScanIcon },
          ] as const
        ).map(({ mode, label, Icon }) => (
          <button
            key={mode}
            type="button"
            onClick={() => arm(mode)}
            aria-pressed={drawMode === mode}
            className={`flex flex-1 items-center justify-center gap-1.5 px-2 focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none ${segment.base} ${
              drawMode === mode ? segment.active : segment.inactive
            }`}
          >
            <Icon className="size-3.5 shrink-0" aria-hidden />
            {label}
          </button>
        ))}
      </div>

      {studyArea ? (
        <div className="mt-2 flex items-baseline justify-between gap-2">
          <span className={`min-w-0 truncate ${text.caption}`}>
            Focused on {describeStudyArea(studyArea)}
          </span>
          <button
            type="button"
            onClick={() => setStudyArea(null)}
            className="shrink-0 rounded-md text-[11px] text-foreground underline underline-offset-2 transition-colors hover:text-primary focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            Clear
          </button>
        </div>
      ) : (
        <p className={`mt-1.5 ${text.hint}`}>
          {drawMode
            ? "Finish the shape on the map."
            : "The heatmap and the shortlist both narrow to the area you draw."}
        </p>
      )}
    </div>
  );
}

/**
 * The permanent left-side companion to the results card. These controls are
 * used while reading the map, so hiding them behind a disclosure made the
 * product's available data and area tools needlessly hard to discover.
 */
export default function LayersCard() {
  const layers = useMapStore((s) => s.layers);

  const activeCount =
    LAYER_META.filter((m) => m.available && layers[m.id].visible).length +
    (layers.hotspots.visible ? 1 : 0) +
    (layers.underserved.visible ? 1 : 0);

  return (
    <aside
      aria-label="Map layers and area tools"
      className={`pointer-events-auto flex max-h-[calc(100vh-8rem)] w-64 flex-col ${panelSurface}`}
    >
      <div className="flex shrink-0 items-center gap-2 border-b border-border px-3 py-2.5 text-xs font-medium">
        <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        Map layers
        <span className="ml-auto rounded-full bg-foreground/10 px-1.5 py-px font-mono text-[10px] text-muted-foreground tabular-nums">
          {activeCount} on
        </span>
      </div>

      <div className="scrollbar-subtle min-h-0 overflow-y-auto p-3">
        <SectionLabel>Show on map</SectionLabel>
        <div className="mt-1.5">
          {LAYER_META.map((meta) => (
            <LayerRow key={meta.id} id={meta.id} />
          ))}
        </div>

        <Separator className="my-3" />

        <SectionLabel>Focus an area</SectionLabel>
        <div className="mt-1.5">
          <DrawTools />
        </div>

        <Separator className="my-3" />

        <SectionLabel>Find patterns</SectionLabel>
        <div className="mt-1.5">
          <AnalysisPanel />
        </div>
      </div>
    </aside>
  );
}
