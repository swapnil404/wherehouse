import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { ArrowRightIcon } from "lucide-react";
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
      <div className="flex w-full max-w-xl flex-col items-center transition-[max-width] duration-300">
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
            <div className="overflow-hidden border-y border-white/15">
              <ChoiceCard
                description="Tell us the use case, priorities, reach and search area. We configure the map around them."
                footnote="About 1 min · Recommended"
                index="01"
                onClick={() => setAsking(true)}
                primary
                title="Answer a few questions"
              />
              <ChoiceCard
                description="Open the full Austin map with every control available and nothing preconfigured."
                footnote="Explore manually"
                index="02"
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
 * One of the two ways into the app. These are deliberately rows in one compact
 * entry menu, not two dashboard cards: there is no data to contain yet, only a
 * decision to make.
 */
function ChoiceCard({
  title,
  description,
  footnote,
  index,
  primary = false,
  onClick,
}: {
  title: string;
  description: string;
  /** The cost of choosing this, which is the thing being weighed. */
  footnote: string;
  index: string;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`group relative grid w-full grid-cols-[2.75rem_1fr_auto] items-center gap-4 px-1 py-5 text-left transition-colors duration-200 focus-visible:bg-white/[0.04] focus-visible:outline-none sm:grid-cols-[3.25rem_1fr_auto] ${
        primary ? "hover:bg-accent/[0.055]" : "border-t border-white/10 hover:bg-white/[0.035]"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`font-display text-xl tracking-wider transition-colors ${
          primary ? "text-accent" : "text-white/30 group-hover:text-white/55"
        }`}
      >
        {index}
      </span>

      <span className="min-w-0">
        <span className="block text-[15px] font-medium text-foreground">{title}</span>
        <span className={`mt-1 block max-w-md ${text.hint}`}>{description}</span>
        <span className={`mt-2 block ${text.label}`}>{footnote}</span>
      </span>

      <span
        className={`grid size-9 place-items-center rounded-full transition-all duration-200 ${
          primary
            ? "bg-accent text-accent-foreground group-hover:scale-105"
            : "border border-white/15 text-muted-foreground group-hover:border-white/35 group-hover:text-foreground"
        }`}
      >
        <ArrowRightIcon
          aria-hidden
          className="size-4 transition-transform duration-200 group-hover:translate-x-0.5"
        />
      </span>
    </button>
  );
}
