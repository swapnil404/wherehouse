import { useQuery } from "@tanstack/react-query";
import { createFileRoute, useNavigate } from "@tanstack/react-router";
import { CompassIcon, ListChecksIcon } from "lucide-react";
import { useState } from "react";
import { toast } from "sonner";

import OnboardingWizard from "@/components/onboarding-wizard";
import { panelSurface, text } from "@/components/panel-styles";
import { authClient } from "@/lib/auth-client";
import type { Weights } from "@/lib/cells";
import { deriveSetup, projectNameFor, type Answers } from "@/lib/onboarding";
import { useProjects } from "@/lib/use-projects";
import { useMapStore } from "@/stores/map-store";
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
  const setEligibleOnly = useMapStore((state) => state.setEligibleOnly);
  const setCatchmentOn = useMapStore((state) => state.setCatchmentOn);
  const setCatchmentMode = useMapStore((state) => state.setCatchmentMode);
  const setDrawMode = useMapStore((state) => state.setDrawMode);

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
    applyProjectSetup(setup.preset, weights);
    setEligibleOnly(setup.eligibleOnly);
    setCatchmentOn(setup.catchment !== null);
    if (setup.catchment) setCatchmentMode(setup.catchment.mode);
    setDrawMode(setup.startDrawing ? "polygon" : null);

    // Persistence, so the answers survive a reload as a workspace. A failure
    // here costs the saved project, not the configuration the reader just
    // described — so it is reported and then stepped over rather than
    // swallowing the navigation with it.
    try {
      await createProject.mutateAsync({
        name: projectNameFor(answers),
        preset: setup.preset,
        weights: weights as Record<string, number>,
      });
    } catch {
      toast.error("Could not save this as a project", {
        description: "The map is set up from your answers, but it will not be here after a reload.",
      });
    }

    navigate({ to: "/dashboard" });
  };

  return (
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="flex w-full max-w-xl flex-col items-center">
        <h1 className="text-center font-display text-2xl font-semibold">
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
              presetWeights={presets.data ?? null}
            />
          ) : (
            <div className="grid gap-3 sm:grid-cols-2">
              <ChoiceCard
                description="Six questions about the site you want. We set the use case, the scoring weights and the search area from your answers."
                icon={<ListChecksIcon className="size-4" aria-hidden />}
                onClick={() => setAsking(true)}
                primary
                title="Answer a few questions"
              />
              <ChoiceCard
                description="Open the map as it is. Every control the questions would have set is available there anyway."
                icon={<CompassIcon className="size-4" aria-hidden />}
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

function ChoiceCard({
  title,
  description,
  icon,
  primary = false,
  onClick,
}: {
  title: string;
  description: string;
  icon: React.ReactNode;
  primary?: boolean;
  onClick: () => void;
}) {
  return (
    <button
      className={`flex h-full flex-col items-start gap-2 p-4 text-left transition-colors focus-visible:ring-1 focus-visible:ring-ring/50 focus-visible:outline-none ${panelSurface} ${
        primary ? "border-accent/60 hover:bg-accent/10" : "hover:bg-white/5"
      }`}
      onClick={onClick}
      type="button"
    >
      <span
        className={`grid size-8 place-items-center rounded-md ${
          primary ? "bg-accent text-accent-foreground" : "bg-white/8 text-muted-foreground"
        }`}
      >
        {icon}
      </span>
      <span className="text-[13px] font-medium text-foreground">{title}</span>
      <span className={text.hint}>{description}</span>
    </button>
  );
}
