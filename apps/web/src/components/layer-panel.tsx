import { Checkbox } from "@wherehouse/ui/components/checkbox";
import { Label } from "@wherehouse/ui/components/label";
import { Separator } from "@wherehouse/ui/components/separator";
import { Slider } from "@wherehouse/ui/components/slider";

import HeatmapLegend from "./heatmap-legend";
import { SUBSCORE_KEYS, SUBSCORE_LABELS } from "@/lib/cells";
import { LAYER_META, useMapStore, type LayerId } from "@/stores/map-store";

function SectionHeading({ children }: { children: React.ReactNode }) {
  return (
    <h2 className="text-[10px] font-medium tracking-[0.08em] text-muted-foreground uppercase">
      {children}
    </h2>
  );
}

function LayerRow({ id }: { id: LayerId }) {
  const meta = LAYER_META.find((m) => m.id === id)!;
  const layer = useMapStore((s) => s.layers[id]);
  const toggleLayer = useMapStore((s) => s.toggleLayer);
  const setLayerOpacity = useMapStore((s) => s.setLayerOpacity);

  const disabled = !meta.available;

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
              ? "flex-1 cursor-not-allowed text-sm text-muted-foreground"
              : "flex-1 cursor-pointer text-sm"
          }
        >
          {meta.label}
        </Label>
      </div>

      {disabled ? (
        <p className="mt-0.5 pl-[26px] text-[11px] text-muted-foreground/70">{meta.hint}</p>
      ) : layer.visible ? (
        <div className="mt-1 flex items-center gap-2 pl-[26px]">
          <Slider
            aria-label={`${meta.label} opacity`}
            value={Math.round(layer.opacity * 100)}
            min={0}
            max={100}
            step={5}
            onValueChange={(value) => {
              if (typeof value === "number") setLayerOpacity(id, value / 100);
            }}
          />
          <span className="w-8 shrink-0 text-right text-[11px] tabular-nums text-muted-foreground">
            {Math.round(layer.opacity * 100)}%
          </span>
        </div>
      ) : null}
    </div>
  );
}

/**
 * Docked left rail. Layer toggles and the legend live here because they are
 * always relevant; the score panel floats over the map instead, since it only
 * has anything to say once a cell is picked.
 */
export default function LayerPanel() {
  return (
    <aside className="flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-card p-4">
      <div>
        <SectionHeading>Layers</SectionHeading>
        <div className="mt-2">
          {LAYER_META.map((meta) => (
            <LayerRow key={meta.id} id={meta.id} />
          ))}
        </div>
      </div>

      <Separator />

      {/* Placeholder: the weight editor is a later pass. The section is laid
          out now so dropping real sliders in needs no restructuring. */}
      <div aria-hidden className="opacity-40">
        <div className="flex items-baseline justify-between">
          <SectionHeading>Weights</SectionHeading>
          <span className="text-[10px] text-muted-foreground">soon</span>
        </div>
        <div className="mt-2 space-y-2">
          {SUBSCORE_KEYS.map((key) => (
            <div key={key}>
              <div className="flex items-baseline justify-between">
                <span className="text-[11px] text-muted-foreground">
                  {SUBSCORE_LABELS[key]}
                </span>
                <span className="text-[11px] text-muted-foreground">—</span>
              </div>
              <div className="mt-1 h-1 w-full rounded-full bg-input" />
            </div>
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <SectionHeading>Score</SectionHeading>
        <div className="mt-2">
          <HeatmapLegend hasData={false} />
        </div>
      </div>
    </aside>
  );
}
