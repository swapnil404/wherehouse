import { Skeleton } from "@wherehouse/ui/components/skeleton";

/**
 * Route-level pending state.
 *
 * Used as the router's `defaultPendingComponent`, so it stands in for a
 * screen whose shape is not known here. A skeleton would have to guess that
 * shape and would guess wrong for the map; a centred spinner parks a spinning
 * disc in the middle of an empty page. Instead the surface matches
 * `--background`, which is the basemap colour, and a slim indeterminate bar
 * rides the top edge. The page therefore does not flash a different colour
 * than the map that is about to occupy it.
 */
export default function Loader() {
  return (
    <div className="relative h-full w-full bg-background" aria-busy role="status">
      <span className="sr-only">Loading</span>
      <div className="absolute inset-x-0 top-0 h-px overflow-hidden bg-border">
        <div className="wh-indeterminate h-full w-1/3 bg-primary" />
      </div>
    </div>
  );
}

/**
 * Auth-card placeholder, shown while `authClient.useSession()` resolves.
 *
 * Mirrors the login and sign-up cards it replaces (title, two labelled
 * fields, primary button, provider button) so the card does not pop in at a
 * different height than the space it was holding.
 */
export function AuthCardSkeleton() {
  return (
    <div className="rounded-lg bg-card p-6 ring-1 ring-border" aria-busy role="status">
      <span className="sr-only">Loading</span>
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2.5 h-3 w-60" />

      <div className="mt-8 space-y-5">
        <div className="space-y-2">
          <Skeleton className="h-3 w-12" />
          <Skeleton className="h-10 w-full" />
        </div>
        <div className="space-y-2">
          <Skeleton className="h-3 w-16" />
          <Skeleton className="h-10 w-full" />
        </div>
      </div>

      <Skeleton className="mt-6 h-10 w-full" />
      <Skeleton className="mt-3 h-10 w-full" />
    </div>
  );
}
