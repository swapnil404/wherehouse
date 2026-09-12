import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@wherehouse/ui/components/button";
import { Skeleton } from "@wherehouse/ui/components/skeleton";
import { LogOutIcon } from "lucide-react";
import { useState } from "react";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();
  const [isSigningOut, setIsSigningOut] = useState(false);

  if (isPending) {
    return <Skeleton className="h-8 w-36 rounded-md" />;
  }

  if (!session) {
    return (
      <Link to="/login">
        <Button variant="outline">Sign in</Button>
      </Link>
    );
  }

  return (
    <div className="flex shrink-0 items-center gap-2">
      <div className="hidden items-center gap-2.5 border-r border-white/10 pr-3 md:flex">
        <span className="grid size-7 place-items-center rounded-full bg-white/8 text-[11px] font-semibold text-foreground ring-1 ring-white/10">
          {session.user.name.trim().charAt(0).toUpperCase()}
        </span>
        <span className="max-w-40 truncate text-xs font-medium text-foreground/85">
          {session.user.name}
        </span>
      </div>
      <Button
        type="button"
        variant="ghost"
        size="sm"
        disabled={isSigningOut}
        className="gap-1.5 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"
        onClick={() => {
          setIsSigningOut(true);
          authClient.signOut({
            fetchOptions: {
              onSuccess: () => {
                navigate({ to: "/login" });
              },
              onError: () => {
                setIsSigningOut(false);
              },
            },
          });
        }}
      >
        <LogOutIcon aria-hidden />
        <span className="hidden sm:inline">{isSigningOut ? "Logging out…" : "Log out"}</span>
        <span className="sr-only sm:hidden">{isSigningOut ? "Logging out" : "Log out"}</span>
      </Button>
    </div>
  );
}
