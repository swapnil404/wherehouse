import { PRESET_LABELS, type PresetName } from "@/lib/cells";
import { useMapStore } from "@/stores/map-store";

import { panelSurface, segment } from "./panel-styles";

/**
 * Floating use-case switcher, top-left of the map.
 *
 * Sits on the map rather than in the rail because it reframes the entire
 * view — switching from warehouse to retail inverts the heatmap — so it reads
 * as a mode control for the whole canvas, not one setting among the layer
 * toggles.
 *
 * Left rather than centred. Centred, it ran into the results card on any
 * screen under about 1100px: a ~280px picker in the middle and a 288px card
 * on the right need roughly 620px of map between them, and a centred element
 * spends its width on both sides of the midpoint. Anchored left, the two
 * cannot meet until the map is narrower than either of them.
 *
 * Positioning belongs to `map-view`, which stacks this above the layers
 * button in one top-left column. Both are "what am I looking at" controls,
 * so they read as a pair rather than as two unrelated things that happen to
 * share a corner.
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
    <div
      role="group"
      aria-label="Scoring use case"
      className={`pointer-events-auto flex gap-1 p-1 ${panelSurface}`}
    >
      {available.map((name) => {
        const active = name === preset;
        return (
          <button
            key={name}
            type="button"
            aria-pressed={active}
            onClick={() => setPreset(name)}
            className={`${segment.base} ${active ? segment.active : segment.inactive}`}
          >
            {PRESET_LABELS[name] ?? name}
          </button>
        );
      })}
    </div>
  );
}
