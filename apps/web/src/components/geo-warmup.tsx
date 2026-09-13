import { useQuery } from "@tanstack/react-query";
import { useEffect, useRef, useState } from "react";
import { toast } from "sonner";

import { useTRPC } from "@/utils/trpc";

/**
 * Render's free tier spins the analysis sidecar down after ~15 minutes idle and
 * cold-starts it in roughly 50 seconds. Without this, the first person to open
 * the app after a quiet spell watches an empty map and a spinner for most of a
 * minute with nothing saying why, which reads as broken rather than as slow.
 *
 * Two things happen here. The probe itself *causes* the spin-up, so the wait
 * starts while someone is still logging in rather than when they click a hex.
 * And once it is clear the wait is real, a toast names it.
 *
 * Deliberately client-only. The point is to not block anything, and a probe
 * running during SSR would hold the server render open for exactly as long as
 * the cold start it is reporting on.
 */

/**
 * Long enough that a warm sidecar never flashes a warning about a wait that did
 * not happen. A warm `/health` answers in well under a second, so anything
 * still outstanding at this point is a genuine spin-up.
 */
const GRACE_MS = 2_500;
const POLL_MS = 4_000;
/**
 * Past this it is not a cold start any more, it is an outage. The distinction
 * matters to the reader: "still warming up" invites waiting, and after a minute
 * and a half waiting is the wrong advice.
 */
const GIVE_UP_MS = 90_000;

const TOAST_ID = "geo-warmup";

export default function GeoWarmup() {
  const trpc = useTRPC();
  const [mounted, setMounted] = useState(false);
  const startedAt = useRef(0);
  const announced = useRef(false);

  useEffect(() => {
    startedAt.current = Date.now();
    setMounted(true);
  }, []);

  const health = useQuery({
    ...trpc.geo.health.queryOptions(),
    enabled: mounted,
    // The answer is a fact about right now, so a cached "not ready" is worse
    // than no answer at all.
    staleTime: 0,
    gcTime: 0,
    // This component *is* the error UI for the probe, and it already polls, so
    // the global toast and the retry ladder would both be reporting a wait the
    // toast below is describing in plain words.
    meta: { silent: true },
    retry: false,
    refetchInterval: (query) => {
      if (query.state.data?.ready) return false;
      if (Date.now() - startedAt.current > GIVE_UP_MS) return false;
      return POLL_MS;
    },
  });

  const ready = health.data?.ready === true;
  const probed = health.data !== undefined;
  const gaveUp =
    probed && !ready && Date.now() - startedAt.current > GIVE_UP_MS;

  const [graceElapsed, setGraceElapsed] = useState(false);
  useEffect(() => {
    if (!mounted) return;
    const timer = setTimeout(() => setGraceElapsed(true), GRACE_MS);
    return () => clearTimeout(timer);
  }, [mounted]);

  useEffect(() => {
    if (ready) {
      // Only worth announcing if we said it was warming in the first place.
      // Otherwise a fast start would pop a toast to report that nothing
      // happened.
      if (announced.current) {
        toast.success("Analysis engine ready", { id: TOAST_ID, duration: 2_500 });
      }
      return;
    }

    if (gaveUp) {
      announced.current = true;
      toast.error("Analysis engine is not responding", {
        id: TOAST_ID,
        description: "Scores and the heatmap will fail until it comes back.",
        duration: Infinity,
      });
      return;
    }

    if (graceElapsed) {
      announced.current = true;
      toast.loading("Warming up analysis engine…", {
        id: TOAST_ID,
        description: "First load after a quiet spell takes up to a minute.",
        duration: Infinity,
      });
    }
  }, [ready, gaveUp, graceElapsed]);

  return null;
}
