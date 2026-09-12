import { Checkbox } from "@wherehouse/ui/components/checkbox";
import { Label } from "@wherehouse/ui/components/label";
import { Separator } from "@wherehouse/ui/components/separator";
import { Slider } from "@wherehouse/ui/components/slider";
import {
  CircleDashedIcon,
  LayersIcon,
  PencilLineIcon,
  ScanIcon,
} from "lucide-react";
import { useCallback, useState } from "react";

import { GRID_MEASURES } from "@/lib/heatmap-palette";
import { describeStudyArea, type DrawMode } from "@/lib/study-area";
import { useEscapeToClose } from "@/lib/use-escape-to-close";
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
function DrawTools({ onArm }: { onArm: () => void }) {
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
    onArm();
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
 * What is drawn on the map, on demand.
 *
 * This was a docked 256px rail down the left edge. Everything in it was
 * configuration, so a fifth of the window was permanently spent on settings
 * for a product whose entire subject is the map behind them, and the first
 * thing the eye met on load was a column of controls rather than Austin.
 *
 * The controls did not need to go; the column did. These are the ones that
 * change what the map draws, so they live on the map, behind a labelled
 * button, and cost nothing until asked for. The ones that change what the
 * score means moved the other way, into the results card beside the ranking
 * they reorder.
 *
 * A count on the button so the closed state still reports whether anything
 * is on. Without it, switching a layer off and forgetting is invisible.
 *
 * It stays open until the button or Escape closes it. Dismissing on an
 * outside press is the usual popover behaviour and was actively hostile
 * here: the map is what is outside the panel, and clicking the map is the
 * app's main action, so ticking an overlay and then scoring a cell shut the
 * panel every single time.
 */
export default function LayersCard() {
  const [open, setOpen] = useState(false);
  const layers = useMapStore((s) => s.layers);

  const close = useCallback(() => setOpen(false), []);
  useEscapeToClose(open, close);

  const activeCount =
    LAYER_META.filter((m) => m.available && layers[m.id].visible).length +
    (layers.hotspots.visible ? 1 : 0) +
    (layers.underserved.visible ? 1 : 0);

  return (
    <div className="pointer-events-auto relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        className={`flex items-center gap-2 py-1.5 pr-2.5 pl-3 text-xs font-medium transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none ${panelSurface}`}
      >
        <LayersIcon className="size-3.5 shrink-0 text-muted-foreground" aria-hidden />
        Layers
        {activeCount > 0 ? (
          <span className="rounded-full bg-foreground/10 px-1.5 py-px font-mono text-[10px] tabular-nums">
            {activeCount}
          </span>
        ) : null}
      </button>

      {open ? (
        <div
          className={`scrollbar-subtle absolute top-full left-0 mt-2 max-h-[70vh] w-64 overflow-y-auto p-3 ${panelSurface}`}
        >
          <SectionLabel>Show on map</SectionLabel>
          <div className="mt-1.5">
            {LAYER_META.map((meta) => (
              <LayerRow key={meta.id} id={meta.id} />
            ))}
          </div>

          <Separator className="my-3" />

          <SectionLabel>Focus an area</SectionLabel>
          <div className="mt-1.5">
            <DrawTools onArm={close} />
          </div>

          <Separator className="my-3" />

          <SectionLabel>Find patterns</SectionLabel>
          <div className="mt-1.5">
            <AnalysisPanel />
          </div>
        </div>
      ) : null}
    </div>
  );
}
