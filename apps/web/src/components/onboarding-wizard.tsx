import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";
import { useMemo, useRef, useState } from "react";

import { SUBSCORE_KEYS, SUBSCORE_LABELS, type PresetName, type Weights } from "@/lib/cells";
import {
  ACCESS_OPTIONS,
  applyEmphasis,
  deriveSetup,
  ELIGIBILITY_OPTIONS,
  EMPTY_ANSWERS,
  LOCATION_KINDS,
  MAX_PRIORITIES,
  PRIORITY_OPTIONS,
  PURPOSES,
  SCOPES,
  type Answers,
  type Option,
} from "@/lib/onboarding";

import { panelSurface, text } from "./panel-styles";

/**
 * Six questions that stand in for the weight sliders.
 *
 * The sliders are the honest control and they stay the honest control — this
 * only sets their starting position from answers a reader can give before they
 * know what a subscore is. Which is why the last screen prints the weights it
 * derived rather than just claiming to have configured something: the reader
 * can check the translation, and change it on the Tune tab the moment the map
 * opens.
 */

type StepId = "kind" | "purpose" | "scope" | "access" | "eligibility" | "priorities" | "summary";

const STEPS: readonly StepId[] = [
  "kind",
  "purpose",
  "scope",
  "access",
  "eligibility",
  "priorities",
  "summary",
] as const;

/** The six that carry a number; the summary is not a question. */
const QUESTION_COUNT = STEPS.length - 1;

const PROMPTS: Record<Exclude<StepId, "summary">, { title: string; hint?: string }> = {
  kind: { title: "What kind of location are you looking for?" },
  purpose: { title: "What will this location mainly support?" },
  scope: { title: "Which area should we search?" },
  access: { title: "What kind of access matters most?" },
  eligibility: {
    title: "Which locations should appear in your results?",
    hint: "Each preset has fixed rules for flood risk, access, zoning, and site suitability.",
  },
  priorities: {
    title: "What should Wherehouse prioritize when ranking sites?",
    hint: `Choose up to ${MAX_PRIORITIES}.`,
  },
};

export default function OnboardingWizard({
  presetWeights,
  presetError,
  isSubmitting,
  onComplete,
  onCancel,
  onRetryPreset,
}: {
  /** The sidecar's own weights for the chosen use case, when they have arrived. */
  presetWeights: Partial<Record<PresetName, Weights>> | null;
  presetError: boolean;
  isSubmitting: boolean;
  onComplete: (answers: Answers, weights: Weights) => void;
  onCancel: () => void;
  onRetryPreset: () => void;
}) {
  const [stepIndex, setStepIndex] = useState(0);
  const [answers, setAnswers] = useState<Answers>(EMPTY_ANSWERS);
  const step = STEPS[stepIndex];

  const derived = useMemo(() => deriveSetup(answers), [answers]);
  const weights = useMemo(
    () => applyEmphasis(presetWeights?.[derived.preset] ?? {}, derived.emphasis, derived.floored),
    [presetWeights, derived],
  );

  const answered = (() => {
    switch (step) {
      case "kind": return answers.kind !== null;
      case "purpose": return answers.purpose !== null;
      case "scope": return answers.scope !== null;
      case "access": return answers.access !== null;
      case "eligibility": return answers.eligibility !== null;
      case "priorities": return answers.priorities.length > 0;
      case "summary": return true;
    }
  })();

  const togglePriority = (value: (typeof PRIORITY_OPTIONS)[number]["value"]) => {
    setAnswers((current) => {
      if (current.priorities.includes(value)) {
        return { ...current, priorities: current.priorities.filter((entry) => entry !== value) };
      }
      if (current.priorities.length >= MAX_PRIORITIES) return current;
      return { ...current, priorities: [...current.priorities, value] };
    });
  };

  return (
    <div className={`w-full max-w-xl overflow-hidden ${panelSurface}`}>
      <div className="flex items-center justify-between border-b border-white/10 px-5 py-3">
        <p className={text.label}>
          {step === "summary" ? "Ready" : `Question ${stepIndex + 1} of ${QUESTION_COUNT}`}
        </p>
        <button
          className="text-[11px] text-muted-foreground transition-colors hover:text-foreground"
          onClick={onCancel}
          type="button"
        >
          Skip to the map
        </button>
      </div>

      {/* A bar rather than a number alone: six questions is short enough that
          seeing the end approach is what keeps someone going. */}
      <div className="h-0.5 bg-white/5" aria-hidden>
        <div
          className="h-full bg-accent transition-[width] duration-300"
          style={{ width: `${(stepIndex / QUESTION_COUNT) * 100}%` }}
        />
      </div>

      <div className="max-h-[min(30rem,calc(100vh-18rem))] overflow-y-auto p-5">
        {step === "summary" ? (
          <Summary
            lines={derived.summary}
            onRetryPreset={onRetryPreset}
            presetError={presetError}
            weights={weights}
          />
        ) : (
          <>
            <h2 className="font-display text-base font-semibold">{PROMPTS[step].title}</h2>
            {PROMPTS[step].hint ? (
              <p className={`mt-1.5 ${text.hint}`}>{PROMPTS[step].hint}</p>
            ) : null}

            <div className="mt-4">
              {step === "kind" ? (
                <SingleSelect
                  label={PROMPTS.kind.title}
                  onSelect={(kind) =>
                    // The next question's options belong to this answer, so a
                    // change here has to drop the one built on the old answer.
                    setAnswers((current) => ({
                      ...current,
                      kind,
                      purpose: current.kind === kind ? current.purpose : null,
                    }))
                  }
                  options={LOCATION_KINDS}
                  selected={answers.kind}
                />
              ) : null}

              {step === "purpose" && answers.kind ? (
                <SingleSelect
                  label={PROMPTS.purpose.title}
                  onSelect={(purpose) => setAnswers((current) => ({ ...current, purpose }))}
                  options={PURPOSES[answers.kind]}
                  selected={answers.purpose}
                />
              ) : null}

              {step === "scope" ? (
                <SingleSelect
                  label={PROMPTS.scope.title}
                  onSelect={(scope) => setAnswers((current) => ({ ...current, scope }))}
                  options={SCOPES}
                  selected={answers.scope}
                />
              ) : null}

              {step === "access" ? (
                <SingleSelect
                  label={PROMPTS.access.title}
                  onSelect={(access) => setAnswers((current) => ({ ...current, access }))}
                  options={ACCESS_OPTIONS}
                  selected={answers.access}
                />
              ) : null}

              {step === "eligibility" ? (
                <SingleSelect
                  label={PROMPTS.eligibility.title}
                  onSelect={(eligibility) =>
                    setAnswers((current) => ({ ...current, eligibility }))
                  }
                  options={ELIGIBILITY_OPTIONS}
                  selected={answers.eligibility}
                />
              ) : null}

              {step === "priorities" ? (
                <MultiSelect
                  disabledUnselected={answers.priorities.length >= MAX_PRIORITIES}
                  onToggle={togglePriority}
                  options={PRIORITY_OPTIONS}
                  selected={answers.priorities}
                />
              ) : null}

              <p className="mt-3 text-right font-mono text-[10px] text-muted-foreground/60">
                1–9 choose · arrow keys move
              </p>
            </div>
          </>
        )}
      </div>

      <div className="flex items-center justify-between gap-3 border-t border-white/10 px-5 py-3">
        <button
          className="flex items-center gap-1.5 rounded-md px-2 py-1.5 text-xs text-muted-foreground transition-colors hover:text-foreground disabled:opacity-40"
          disabled={stepIndex === 0}
          onClick={() => setStepIndex((index) => Math.max(0, index - 1))}
          type="button"
        >
          <ArrowLeftIcon className="size-3.5" aria-hidden />
          Back
        </button>

        {step === "summary" ? (
          <button
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:opacity-50"
            disabled={isSubmitting || weights === null}
            onClick={() => {
              if (weights) onComplete(answers, weights);
            }}
            type="button"
          >
            {isSubmitting ? "Setting up…" : weights ? "Open the map" : "Waiting for scoring…"}
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </button>
        ) : (
          <button
            className="flex items-center gap-2 rounded-md bg-accent px-4 py-2 text-xs font-medium text-accent-foreground transition-colors hover:bg-accent/90 disabled:cursor-not-allowed disabled:opacity-40"
            disabled={!answered}
            onClick={() => setStepIndex((index) => Math.min(STEPS.length - 1, index + 1))}
            type="button"
          >
            Continue
            <ArrowRightIcon className="size-3.5" aria-hidden />
          </button>
        )}
      </div>
    </div>
  );
}

const ROW =
  "flex w-full items-center gap-3 rounded-md border px-3 py-2.5 text-left text-[13px] transition-colors";
const ROW_ON = "border-accent/70 bg-accent/10 text-foreground";
const ROW_OFF = "border-white/10 text-foreground/85 hover:border-white/20 hover:bg-white/5";

function keyedOptionIndex(
  event: React.KeyboardEvent,
  buttons: readonly (HTMLButtonElement | null)[],
) {
  if (/^[1-9]$/.test(event.key)) {
    const index = Number(event.key) - 1;
    return index < buttons.length ? index : null;
  }

  const direction =
    event.key === "ArrowDown" || event.key === "ArrowRight"
      ? 1
      : event.key === "ArrowUp" || event.key === "ArrowLeft"
        ? -1
        : 0;
  if (direction === 0) return null;

  const focused = buttons.findIndex((button) => button === document.activeElement);
  const start = focused >= 0 ? focused : direction > 0 ? -1 : 0;
  for (let offset = 1; offset <= buttons.length; offset += 1) {
    const index = (start + direction * offset + buttons.length) % buttons.length;
    if (!buttons[index]?.disabled) return index;
  }
  return null;
}

function NumberKey({ index }: { index: number }) {
  return (
    <span className="w-3 shrink-0 text-center font-mono text-[10px] text-muted-foreground/65 tabular-nums">
      {index + 1}
    </span>
  );
}

function Marker({ on, round }: { on: boolean; round: boolean }) {
  return (
    <span
      aria-hidden
      className={`grid size-4 shrink-0 place-items-center border transition-colors ${
        round ? "rounded-full" : "rounded-[4px]"
      } ${on ? "border-accent bg-accent text-accent-foreground" : "border-white/25"}`}
    >
      {on ? <CheckIcon className="size-2.5" strokeWidth={3} /> : null}
    </span>
  );
}

function SingleSelect<T extends string>({
  options,
  selected,
  onSelect,
  label,
}: {
  options: readonly Option<T>[];
  selected: T | null;
  onSelect: (value: T) => void;
  label: string;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div
      aria-label={label}
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        const index = keyedOptionIndex(event, buttons.current);
        if (index === null) return;
        event.preventDefault();
        event.stopPropagation();
        const option = options[index];
        if (!option) return;
        buttons.current[index]?.focus();
        onSelect(option.value);
      }}
      role="radiogroup"
    >
      {options.map((option, index) => {
        const on = selected === option.value;
        return (
          <button
            aria-checked={on}
            autoFocus={on || (selected === null && index === 0)}
            className={`${ROW} ${on ? ROW_ON : ROW_OFF}`}
            key={option.value}
            onClick={() => onSelect(option.value)}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            role="radio"
            type="button"
          >
            <NumberKey index={index} />
            <Marker on={on} round />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function MultiSelect<T extends string>({
  options,
  selected,
  onToggle,
  disabledUnselected = false,
}: {
  options: readonly Option<T>[];
  selected: readonly T[];
  onToggle: (value: T) => void;
  /** Set once a cap is reached, so the limit is visible rather than silent. */
  disabledUnselected?: boolean;
}) {
  const buttons = useRef<(HTMLButtonElement | null)[]>([]);

  return (
    <div
      className="flex flex-col gap-2"
      onKeyDown={(event) => {
        const index = keyedOptionIndex(event, buttons.current);
        if (index === null) return;
        event.preventDefault();
        event.stopPropagation();
        const option = options[index];
        const button = buttons.current[index];
        if (!option || !button) return;
        button.focus();
        // Number keys are direct choices. Arrow keys only move through a
        // checkbox list, preserving Space/Enter as the deliberate toggle.
        if (/^[1-9]$/.test(event.key) && !button.disabled) onToggle(option.value);
      }}
    >
      {options.map((option, index) => {
        const on = selected.includes(option.value);
        return (
          <button
            aria-pressed={on}
            autoFocus={index === 0}
            className={`${ROW} ${on ? ROW_ON : ROW_OFF} disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!on && disabledUnselected}
            key={option.value}
            onClick={() => onToggle(option.value)}
            ref={(button) => {
              buttons.current[index] = button;
            }}
            type="button"
          >
            <NumberKey index={index} />
            <Marker on={on} round={false} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Summary({
  lines,
  weights,
  presetError,
  onRetryPreset,
}: {
  lines: readonly string[];
  weights: Weights | null;
  presetError: boolean;
  onRetryPreset: () => void;
}) {
  if (!weights) {
    return (
      <div className="py-8 text-center">
        <h2 className="font-display text-base font-semibold">Preparing your scoring model</h2>
        <p className={`mx-auto mt-2 max-w-sm ${text.hint}`}>
          {presetError
            ? "The scoring service did not return the official preset weights."
            : "Loading the official preset weights so your answers always produce the same result."}
        </p>
        {presetError ? (
          <button
            className="mt-4 rounded-md border border-white/15 px-3 py-2 text-xs text-foreground transition-colors hover:bg-white/5"
            onClick={onRetryPreset}
            type="button"
          >
            Try again
          </button>
        ) : null}
      </div>
    );
  }

  const total = SUBSCORE_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0);

  return (
    <>
      <h2 className="font-display text-base font-semibold">
        We&rsquo;ll use these answers to configure your project, scoring weights, and map.
      </h2>

      {/* Real list markers rather than an icon per row. A column of accent
          ticks read as five things having succeeded, which is a claim about the
          past; these are a description of the setup about to be applied. */}
      <ul className="mt-4 list-disc space-y-2 pl-5 marker:text-muted-foreground">
        {lines.map((line) => (
          <li className={text.hint} key={line}>
            {line}
          </li>
        ))}
      </ul>

      {/* Printed, not just promised. These are the numbers the sliders open on,
          so showing them makes the translation checkable instead of a black box
          the reader has to trust. */}
      <div className="mt-5 border-t border-white/10 pt-4">
        <p className={text.label}>Starting weights</p>
        <div className="mt-2.5 space-y-1.5">
          {SUBSCORE_KEYS.map((key) => {
            const share = total > 0 ? ((weights[key] ?? 0) / total) * 100 : 0;
            return (
              <div className="flex items-center gap-3" key={key}>
                <span className="w-32 shrink-0 text-[11px] text-muted-foreground">
                  {SUBSCORE_LABELS[key]}
                </span>
                <span className="h-1 flex-1 overflow-hidden rounded-full bg-white/8">
                  <span
                    className="block h-full rounded-full bg-accent/80"
                    style={{ width: `${share}%` }}
                  />
                </span>
                <span className="w-8 shrink-0 text-right font-mono text-[11px] tabular-nums text-muted-foreground">
                  {share.toFixed(0)}%
                </span>
              </div>
            );
          })}
        </div>
        <p className={`mt-3 ${text.hint}`}>
          Every one of these stays adjustable on the Tune tab.
        </p>
      </div>
    </>
  );
}
