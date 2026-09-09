import { Checkbox } from "@wherehouse/ui/components/checkbox";
import { Label } from "@wherehouse/ui/components/label";
import { Separator } from "@wherehouse/ui/components/separator";
import { Slider } from "@wherehouse/ui/components/slider";
import { CircleDashedIcon } from "lucide-react";

import WeightEditor from "./weight-editor";
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
        <p className="mt-0.5 flex items-center gap-1 pl-6.5 text-[11px] text-muted-foreground/70">
          <CircleDashedIcon className="size-3 shrink-0" />
          {meta.hint}
        </p>
      ) : layer.visible ? (
        <>
          <div className="mt-1 flex items-center gap-2 pl-6.5">
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

          {/* Only shown while the layer is drawn, so the rail carries a key
              for exactly the colors currently on the map. Categories are never
              identified by hue alone. */}
          {meta.legend ? (
            <ul className="mt-1.5 space-y-1 pl-6.5">
              {meta.legend.map((entry) => (
                <li key={entry.label} className="flex items-center gap-2">
                  <span
                    aria-hidden
                    className="size-2.5 shrink-0 rounded-[2px]"
                    style={{ backgroundColor: entry.hex }}
                  />
                  <span className="text-[11px] text-muted-foreground">{entry.label}</span>
                </li>
              ))}
            </ul>
          ) : null}
        </>
      ) : null}

      {/* A hint on an available layer is a caveat, not a blocker — buildings
          only draw past zoom 13. Shown in both states: before ticking the box
          it sets the expectation, after ticking it explains an empty map. */}
      {!disabled && meta.hint ? (
        <p className="mt-1 pl-6.5 text-[11px] text-muted-foreground/70">{meta.hint}</p>
      ) : null}
    </div>
  );
}

/**
 * Docked left rail. Preset, layer toggles and the legend live here because they
 * are always relevant; the score panel floats over the map instead, since it
 * only has anything to say once a cell is picked.
 */
export default function LayerPanel() {
  const stats = useMapStore((s) => s.heatmapStats);
  const eligibleOnly = useMapStore((s) => s.eligibleOnly);
  const setEligibleOnly = useMapStore((s) => s.setEligibleOnly);
  const preset = useMapStore((s) => s.preset);
  const presets = useMapStore((s) => s.presets);

  return (
    <aside className="scrollbar-subtle flex w-64 shrink-0 flex-col gap-4 overflow-y-auto border-r border-border bg-card p-4">
      <div>
        <SectionHeading>Layers</SectionHeading>
        <div className="mt-2">
          {LAYER_META.map((meta) => (
            <LayerRow key={meta.id} id={meta.id} />
          ))}
        </div>
      </div>

      <Separator />

      <div>
        <div className="flex items-center gap-2.5">
          <Checkbox
            id="eligible-only"
            checked={eligibleOnly}
            onCheckedChange={(checked) => setEligibleOnly(checked === true)}
          />
          <Label htmlFor="eligible-only" className="flex-1 cursor-pointer text-sm">
            Eligible sites only
          </Label>
        </div>
        <p className="mt-0.5 pl-6.5 text-[11px] text-muted-foreground/70">
          {stats
            ? `${stats.eligible} of ${stats.total} cells pass every constraint`
            : "Passes every hard constraint"}
        </p>
      </div>

      <Separator />

      <WeightEditor presetWeights={presets?.[preset] ?? null} />
    </aside>
  );
}
