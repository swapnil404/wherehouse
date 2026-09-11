import { Checkbox } from "@wherehouse/ui/components/checkbox";
import { Label } from "@wherehouse/ui/components/label";
import { Separator } from "@wherehouse/ui/components/separator";
import { Slider } from "@wherehouse/ui/components/slider";
import { CircleDashedIcon, LayersIcon } from "lucide-react";
import { useCallback, useState } from "react";

import { useEscapeToClose } from "@/lib/use-escape-to-close";
import { LAYER_META, useMapStore, type LayerId } from "@/stores/map-store";

import AnalysisPanel from "./analysis-panel";
import { panelSurface, text } from "./panel-styles";
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
        <div className="mt-1.5 flex items-center gap-2 pl-6.5">
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

          <SectionLabel>Find patterns</SectionLabel>
          <div className="mt-1.5">
            <AnalysisPanel />
          </div>
        </div>
      ) : null}
    </div>
  );
}
