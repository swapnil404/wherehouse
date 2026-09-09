import { PRESET_LABELS, type PresetName } from "@/lib/cells";
import { useMapStore } from "@/stores/map-store";

/**
 * Floating use-case switcher, centred over the top of the map.
 *
 * Sits on the map rather than in the rail because it reframes the entire
 * view — switching from warehouse to retail inverts the heatmap — so it reads
 * as a mode control for the whole canvas, not one setting among the layer
 * toggles.
 *
 * Full labels here, unlike the cramped rail: floating over the map there is
 * room for "EV charging" rather than "EV".
 */
export default function PresetPicker() {
  const preset = useMapStore((s) => s.preset);
  const setPreset = useMapStore((s) => s.setPreset);
  const presets = useMapStore((s) => s.presets);

  // Before `/v1/presets` lands, show only the current preset — one stable
  // button beats a picker that pops from one option to three.
  const available = presets ? (Object.keys(presets) as PresetName[]) : [preset];

  return (
    <div className="pointer-events-none absolute inset-x-0 top-4 z-10 flex justify-center">
      <div
        role="group"
        aria-label="Scoring use case"
        className="pointer-events-auto flex gap-1 rounded-lg border border-border bg-card/95 p-1 shadow-xl backdrop-blur"
      >
        {available.map((name) => {
          const active = name === preset;
          return (
            <button
              key={name}
              type="button"
              aria-pressed={active}
              onClick={() => setPreset(name)}
              className={
                active
                  ? "rounded-md bg-background px-3 py-1.5 text-xs font-medium shadow-sm"
                  : "rounded-md px-3 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground"
              }
            >
              {PRESET_LABELS[name] ?? name}
            </button>
          );
        })}
      </div>
    </div>
  );
}
