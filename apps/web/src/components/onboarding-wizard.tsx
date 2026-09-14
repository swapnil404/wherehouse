import { ArrowLeftIcon, ArrowRightIcon, CheckIcon } from "lucide-react";
import { useMemo, useState } from "react";

import { SUBSCORE_KEYS, SUBSCORE_LABELS, type PresetName, type Weights } from "@/lib/cells";
import {
  ACCESS_OPTIONS,
  applyEmphasis,
  deriveSetup,
  EMPTY_ANSWERS,
  LOCATION_KINDS,
  MAX_PRIORITIES,
  PRIORITY_OPTIONS,
  PURPOSES,
  REQUIREMENT_OPTIONS,
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

type StepId = "kind" | "purpose" | "scope" | "access" | "requirements" | "priorities" | "summary";

const STEPS: readonly StepId[] = [
  "kind",
  "purpose",
  "scope",
  "access",
  "requirements",
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
  requirements: {
    title: "What must a suitable location satisfy?",
    hint: "Pick as many as apply. These hide locations that fail this use case's hard rules and weight the score toward what you name.",
  },
  priorities: {
    title: "What should Wherehouse prioritize when ranking sites?",
    hint: `Choose up to ${MAX_PRIORITIES}.`,
  },
};

export default function OnboardingWizard({
  presetWeights,
  isSubmitting,
  onComplete,
  onCancel,
}: {
  /** The sidecar's own weights for the chosen use case, when they have arrived. */
  presetWeights: Partial<Record<PresetName, Weights>> | null;
  isSubmitting: boolean;
  onComplete: (answers: Answers, weights: Weights) => void;
  onCancel: () => void;
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
      case "requirements": return answers.requirements.length > 0;
      case "priorities": return answers.priorities.length > 0;
      case "summary": return true;
    }
  })();

  const toggleRequirement = (value: (typeof REQUIREMENT_OPTIONS)[number]["value"]) => {
    setAnswers((current) => {
      // "No strict requirements" contradicts every other answer here, so the
      // two can never be held at once in either direction.
      if (value === "none") {
        return { ...current, requirements: current.requirements.includes("none") ? [] : ["none"] };
      }
      const without = current.requirements.filter((entry) => entry !== "none");
      return {
        ...current,
        requirements: without.includes(value)
          ? without.filter((entry) => entry !== value)
          : [...without, value],
      };
    });
  };

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
          <Summary lines={derived.summary} weights={weights} />
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

              {step === "requirements" ? (
                <MultiSelect
                  onToggle={toggleRequirement}
                  options={REQUIREMENT_OPTIONS}
                  selected={answers.requirements}
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
            disabled={isSubmitting}
            onClick={() => onComplete(answers, weights)}
            type="button"
          >
            {isSubmitting ? "Setting up…" : "Open the map"}
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
  return (
    <div aria-label={label} className="flex flex-col gap-2" role="radiogroup">
      {options.map((option) => {
        const on = selected === option.value;
        return (
          <button
            aria-checked={on}
            className={`${ROW} ${on ? ROW_ON : ROW_OFF}`}
            key={option.value}
            onClick={() => onSelect(option.value)}
            role="radio"
            type="button"
          >
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
  return (
    <div className="flex flex-col gap-2">
      {options.map((option) => {
        const on = selected.includes(option.value);
        return (
          <button
            aria-pressed={on}
            className={`${ROW} ${on ? ROW_ON : ROW_OFF} disabled:cursor-not-allowed disabled:opacity-35`}
            disabled={!on && disabledUnselected}
            key={option.value}
            onClick={() => onToggle(option.value)}
            type="button"
          >
            <Marker on={on} round={false} />
            {option.label}
          </button>
        );
      })}
    </div>
  );
}

function Summary({ lines, weights }: { lines: readonly string[]; weights: Weights }) {
  const total = SUBSCORE_KEYS.reduce((sum, key) => sum + (weights[key] ?? 0), 0);

  return (
    <>
      <h2 className="font-display text-base font-semibold">
        We&rsquo;ll use these answers to configure your project, scoring weights, and site
        requirements.
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
