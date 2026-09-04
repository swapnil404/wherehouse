import { Button } from "@wherehouse/ui/components/button";
import { useState } from "react";
import { toast } from "sonner";

import { authClient } from "@/lib/auth-client";

export default function GoogleSignInButton() {
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
      className="w-full"
      disabled={isPending}
      onClick={signInWithGoogle}
    >
      {isPending ? "Connecting to Google..." : "Continue with Google"}
    </Button>
  );
}
