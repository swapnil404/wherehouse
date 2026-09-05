import { Button } from "@wherehouse/ui/components/button";
import { cn } from "@wherehouse/ui/lib/utils";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function GoogleSignInButton({
  label = "Login with Google",
  className,
}: {
  label?: string;
  className?: string;
}) {
  const [isPending, setIsPending] = useState(false);

  const signInWithGoogle = async () => {
    await authClient.signIn.social(
      {
        provider: "google",
        callbackURL: "/dashboard",
      },
      {
        onRequest: () => setIsPending(true),
        onError: (error) => {
          setIsPending(false);
          toast.error(error.error.message || error.error.statusText);
        },
      },
    );
  };

  return (
    <Button
      type="button"
      variant="outline"
      className={cn("w-full", className)}
      disabled={isPending}
      onClick={signInWithGoogle}
    >
      {isPending ? "Connecting to Google..." : label}
    </Button>
  );
}
