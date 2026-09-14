import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon, CompassIcon, ListChecksIcon } from "lucide-react";
import { useState } from "react";

import OnboardingWizard from "@/components/onboarding-wizard";
import { text } from "@/components/panel-styles";
import { authClient } from "@/lib/auth-client";
import type { Weights } from "@/lib/cells";
import { deriveSetup, projectNameFor, type Answers } from "@/lib/onboarding";
import { useProjects } from "@/lib/use-projects";
import { useMapStore, type ProjectMapSettings } from "@/stores/map-store";
import { useTRPC } from "@/utils/trpc";

export const Route = createFileRoute("/_auth/welcome")({
  component: RouteComponent,
});

/**
 * The landing between signing in and the map.
 *
 * The map is a thousand hexagons and eleven controls, and it opens on a preset
 * nobody chose. This page exists so the first thing someone does is say what
 * they are looking for, and so the map they land on is already pointed at it.
 *
 * Free browse is a peer of the questionnaire, not a fine-print escape. Someone
 * returning to a workspace they already tuned should not have to re-answer six
 * questions to see it, and someone who only wants a look around should not be
 * made to declare a use case first.
 */
function RouteComponent() {
  const navigate = useNavigate();
  const trpc = useTRPC();
  const { data: session } = authClient.useSession();
  const { createProject } = useProjects();
  const [asking, setAsking] = useState(false);

  const applyProjectSetup = useMapStore((state) => state.applyProjectSetup);

  /**
   * The sidecar's own weights, which the answers scale rather than replace.
   *
   * Silent on failure: this page is usually the first thing loaded after a
   * sign-in, so it is exactly where a cold analysis engine is still starting.
   * `GeoWarmup` is already reporting that, and `applyEmphasis` falls back to
   * the answers alone, so a second error toast would add noise and no
   * information.
   */
  const presets = useQuery({
    ...trpc.geo.presets.queryOptions(),
    meta: { silent: true },
  });

  const firstName = session?.user.name?.trim().split(/\s+/)[0];

  const handleComplete = async (answers: Answers, weights: Weights) => {
    const setup = deriveSetup(answers);
    const mapSettings: ProjectMapSettings = {
      eligibleOnly: setup.eligibleOnly,
      catchment: {
        enabled: setup.catchment !== null,
        mode: setup.catchment?.mode ?? "car",
        minutes: setup.catchment?.minutes ?? 20,
      },
      searchScope: setup.startDrawing ? "draw" : "city",
    };

    /**
     * The map is configured here and now, from the answers, before anything is
     * written anywhere.
     *
     * This used to route the whole effect of six questions through a database
     * write: create a project, let it become active, and let the header's
     * switcher notice and hand its setup to the map. Every link in that chain
     * had to hold for a single slider to move, so one failed request — a cold
     * sidecar, a dropped connection, a dev server between restarts — meant the
     * reader answered six questions and landed on an untouched map with nothing
     * saying why. The persistence below is now a separate concern that is
     * allowed to fail on its own.
     */
    applyProjectSetup(setup.preset, weights, mapSettings);

    // Persistence, so the answers survive a reload as a workspace. A failure
    // here costs the saved project, not the configuration the reader just
    // described — so it is reported and then stepped over rather than
    // swallowing the navigation with it.
    try {
      await createProject.mutateAsync({
        name: projectNameFor(answers),
        preset: setup.preset,
        weights: weights as Record<string, number>,
        mapSettings,
      });
    } catch {
      // `useProjects` already reports the write failure. The local setup above
      // still opens, so a database outage does not discard six answers.
    }

    navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div
        className={`flex w-full flex-col items-center transition-[max-width] duration-300 ${
          asking ? "max-w-xl" : "max-w-2xl"
        }`}
      >
        <h1 className="text-center font-display text-3xl font-semibold tracking-[0.02em]">
          Welcome{firstName ? `, ${firstName}` : ""}
        </h1>
        <p className={`mt-2 text-center ${text.hint}`}>
          {asking
            ? "Six quick answers, and the map opens pointed at what you are looking for."
            : "Tell us what you are looking for, or go straight to the map."}
        </p>

        <div className="mt-7 w-full">
          {asking ? (
            <OnboardingWizard
              isSubmitting={createProject.isPending}
              onCancel={() => navigate({ to: "/dashboard" })}
              onComplete={handleComplete}
              onRetryPreset={() => void presets.refetch()}
              presetError={presets.isError}
              presetWeights={presets.data ?? null}
            />
          ) : (
            <div className="grid gap-4 sm:grid-cols-2">
              <ChoiceCard
                description="Six questions about the site you want. We set the use case, the scoring weights and the search area from your answers."
                footnote="About a minute"
                icon={<ListChecksIcon className="size-[18px]" aria-hidden />}
                onClick={() => setAsking(true)}
                primary
                title="Answer a few questions"
              />
              <ChoiceCard
                description="Open the map as it is. Every control the questions would have set is available there anyway."
                footnote="Nothing preconfigured"
                icon={<CompassIcon className="size-[18px]" aria-hidden />}
                onClick={() => navigate({ to: "/dashboard" })}
                title="Free browse"
              />
            </div>
          )}
        </div>
      </div>
    </div>
  );
}

/**
 * One of the two ways into the app.
 *
 * On `bg-card` rather than the map's `panelSurface`. That style is translucent
 * black over a backdrop blur, which earns its keep floating above a thousand
 * coloured hexagons and does nothing at all on a solid black page — the cards
 * read as weightless outlines because there was no surface under them and
 * nothing behind them to blur. `--card` is a real elevated grey, so they sit on
 * the page instead of being scratched into it.
 *
 * The footer is pinned with `mt-auto`, which is what keeps the two cards the
 * same height and their arrows on one line no matter how differently their
 * descriptions wrap. Before that, the shorter card carried a block of dead
 * space and the pair looked misaligned rather than parallel.
 */
function ChoiceCard({
  title,
  description,
  footnote,
  icon,
  primary = false,
  onClick,
}: {
  title: string;
  description: string;
  /** The cost of choosing this, which is the thing being weighed. */
  footnote: string;
  icon: React.ReactNode;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`group relative flex h-full flex-col overflow-hidden rounded-lg border bg-card p-5 text-left transition-all duration-200 focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none ${
        primary
          ? "border-accent/45 hover:border-accent/80"
          : "border-border hover:border-white/30"
      }`}
      onClick={onClick}
      type="button"
    >
      {/* A bloom rather than a fill: the accent at full strength over a whole
          card would out-shout the map it is introducing. */}
      {primary ? (
        <span
          aria-hidden
          className="pointer-events-none absolute -top-20 -left-16 size-48 rounded-full bg-accent/25 blur-3xl transition-opacity duration-300 group-hover:bg-accent/35"
        />
      ) : null}

      <span
        className={`relative grid size-10 place-items-center rounded-xl ${
          primary
            ? "bg-accent text-accent-foreground shadow-[0_0_20px_-4px_var(--accent)]"
            : "bg-white/8 text-muted-foreground ring-1 ring-white/10"
        }`}
      >
        {icon}
      </span>

      <span className="relative mt-4 text-[15px] font-medium text-foreground">{title}</span>
      <span className={`relative mt-1.5 ${text.hint}`}>{description}</span>

      <span className="relative mt-auto flex items-center gap-2 pt-5">
        <span className={text.label}>{footnote}</span>
        <ArrowRightIcon
          aria-hidden
          className={`ml-auto size-4 transition-transform duration-200 group-hover:translate-x-0.5 ${
            primary ? "text-accent" : "text-muted-foreground"
          }`}
        />
      </span>
    </button>
  );
}
