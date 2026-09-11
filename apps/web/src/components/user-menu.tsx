import { Link, useNavigate } from "@tanstack/react-router";
import { Button } from "@wherehouse/ui/components/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@wherehouse/ui/components/dropdown-menu";
import { Skeleton } from "@wherehouse/ui/components/skeleton";

import { authClient } from "@/lib/auth-client";

export default function UserMenu() {
  const navigate = useNavigate();
  const { data: session, isPending } = authClient.useSession();

  if (isPending) {
    // Matches the Button's default `h-8` so the header does not shift when the
    // session resolves.
    return <Skeleton className="h-8 w-24" />;
  }

  if (!session) {
    return (
      <Link to="/login">
        <Button variant="outline">Sign in</Button>
      </Link>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger render={<Button variant="ghost" />}>
        {session.user.name}
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="min-w-52">
        {/* Name and email are a heading, not a row. They were `DropdownMenuItem`
            before, which gave them hover, focus and a pointer, so the menu
            offered two things that looked clickable and one that did anything. */}
        <DropdownMenuLabel className="font-normal">
          <span className="block text-xs font-medium text-foreground">
            {session.user.name}
          </span>
          <span className="mt-0.5 block truncate text-[11px] text-muted-foreground">
            {session.user.email}
          </span>
        </DropdownMenuLabel>
        <DropdownMenuSeparator />
        <DropdownMenuItem
          variant="destructive"
          onClick={() => {
            authClient.signOut({
              fetchOptions: {
                onSuccess: () => {
                  navigate({ to: "/login" });
                },
              },
            });
          }}
        >
          Sign out
        </DropdownMenuItem>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}
