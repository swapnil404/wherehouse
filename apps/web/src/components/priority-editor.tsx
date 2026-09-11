import { RotateCcwIcon, SlidersHorizontalIcon, TriangleAlertIcon } from "lucide-react";
import { useState } from "react";

import { SUBSCORE_HINTS, SUBSCORE_KEYS, SUBSCORE_LABELS, type SubscoreKey, type Weights } from "@/lib/cells";
import { useMapStore } from "@/stores/map-store";

import { text } from "./panel-styles";
import SectionLabel from "./section-label";

/**
 * What the score is weighted toward, as a decision rather than as arithmetic.
 *
 * This replaces six sliders labelled with the pipeline's own column names and
 * captioned with renormalized percentages. "Demographics 23%" is a true
 * statement about the model and a useless one to someone choosing a
 * warehouse: it neither says what the dimension covers nor what a different
 * number would get them.
 *
 * Two things changed.
 *
 * The controls are gone by default. The preset already encodes an expert
 * answer, and most sessions should accept it, so the resting state is one
 * sentence naming what currently leads. Nothing to operate unless you want
 * to.
 *
 * When opened, each dimension offers three named levels instead of a
 * continuous 0-1 slider. The levels are relative to the preset rather than
 * absolute, which is what keeps the expert tuning intact: "Normal" is
 * whatever the preset says, so the shape of a warehouse score survives
 * boosting one dimension. A slider forced the reader to invent an absolute
 * number for a quantity they have no intuition about.
 */

type Level = "ignore" | "normal" | "priority";

const LEVELS: readonly { id: Level; label: string }[] = [
  { id: "ignore", label: "Ignore" },
  { id: "normal", label: "Normal" },
  { id: "priority", label: "Priority" },
];

/**
 * A level, as a weight.
 *
 * "Priority" multiplies rather than setting a fixed value, so it stays
 * proportional to the preset. The floor covers dimensions a preset zeroes
 * out: without it, asking to prioritise something the preset ignores would
 * do nothing at all.
 */
function weightFor(level: Level, presetWeight: number): number {
  if (level === "ignore") return 0;
  if (level === "normal") return presetWeight;
  return presetWeight > 0 ? Math.min(1, presetWeight * 2.5) : 0.25;
}

function levelOf(value: number, presetWeight: number): Level {
  if (value <= 0.001) return "ignore";
  if (presetWeight > 0 && value > presetWeight * 1.5) return "priority";
  if (presetWeight <= 0) return "priority";
  return "normal";
}

export default function PriorityEditor({
  presetWeights,
  alwaysOpen = false,
}: {
  /** The active preset's weights from the API, or `null` while loading. */
  presetWeights: Weights | null;
  /**
   * Skip the disclosure and show the levels straight away. Set when the
   * component is already behind one, as it is in the results card's own
   * tab: two doors to the same room is one too many.
   */
  alwaysOpen?: boolean;
}) {
  const customWeights = useMapStore((s) => s.customWeights);
  const setWeight = useMapStore((s) => s.setWeight);
  const resetWeights = useMapStore((s) => s.resetWeights);

  const [open, setOpen] = useState(alwaysOpen);

  const effective = customWeights ?? presetWeights;
  const loading = effective == null || presetWeights == null;
  const total = SUBSCORE_KEYS.reduce((sum, key) => sum + (effective?.[key] ?? 0), 0);

  // Names the two dimensions carrying the most weight, which is the whole of
  // what most readers need to know about the tuning.
  const leading = effective
    ? [...SUBSCORE_KEYS]
        .filter((key) => (effective[key] ?? 0) > 0)
        .sort((a, b) => (effective[b] ?? 0) - (effective[a] ?? 0))
        .slice(0, 2)
        .map((key) => SUBSCORE_LABELS[key].toLowerCase())
    : [];

  return (
    <div>
      <div className="flex items-baseline justify-between gap-2">
        <SectionLabel>What matters</SectionLabel>
        {customWeights ? (
          <button
            type="button"
            onClick={resetWeights}
            className="flex items-center gap-1 rounded-sm text-[11px] text-muted-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none"
          >
            <RotateCcwIcon className="size-3" />
            Reset
          </button>
        ) : null}
      </div>

      <p className={`mt-1.5 ${text.hint}`}>
        {loading
          ? "Loading the scoring profile…"
          : leading.length === 0
            ? "Nothing is weighted yet."
            : customWeights
              ? `Your priorities: ${leading.join(" and ")} lead.`
              : `${leading[0][0].toUpperCase()}${leading[0].slice(1)}${
                  leading[1] ? ` and ${leading[1]}` : ""
                } lead for this use case.`}
      </p>

      {alwaysOpen ? null : (
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          disabled={loading}
          className="mt-2 flex items-center gap-1.5 rounded-md text-[11px] font-medium text-foreground transition-colors hover:text-foreground focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none disabled:opacity-50"
        >
          <SlidersHorizontalIcon className="size-3" />
          {open ? "Done" : "Adjust priorities"}
        </button>
      )}

      {open && !loading ? (
        <div className="mt-3 space-y-3">
          {SUBSCORE_KEYS.map((key) => {
            const presetWeight = presetWeights[key] ?? 0;
            const level = levelOf(effective[key] ?? 0, presetWeight);

            return (
              <div key={key}>
                <p className="text-[12px] font-medium">{SUBSCORE_LABELS[key]}</p>
                <p className={`mt-0.5 ${text.hint}`}>{SUBSCORE_HINTS[key]}</p>

                <div
                  role="group"
                  aria-label={`${SUBSCORE_LABELS[key]} importance`}
                  className="mt-1.5 flex gap-1"
                >
                  {LEVELS.map((option) => {
                    const active = option.id === level;
                    return (
                      <button
                        key={option.id}
                        type="button"
                        aria-pressed={active}
                        onClick={() =>
                          setWeight(
                            key as SubscoreKey,
                            weightFor(option.id, presetWeight),
                            effective,
                          )
                        }
                        className={`flex-1 rounded-md px-1 py-1 text-[11px] transition-colors ${
                          active
                            ? "bg-accent/15 font-medium text-foreground ring-1 ring-accent"
                            : "text-muted-foreground hover:bg-foreground/5 hover:text-foreground"
                        }`}
                      >
                        {option.label}
                      </button>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      ) : null}

      {total === 0 && !loading ? (
        <p className="mt-2 flex items-start gap-1.5 text-[11px] leading-snug text-destructive">
          <TriangleAlertIcon className="mt-px size-3 shrink-0" />
          Everything is ignored, so nothing can be scored. Set at least one to
          Normal.
        </p>
      ) : null}
    </div>
  );
}
