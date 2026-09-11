import { createFileRoute } from "@tanstack/react-router";
import { HexagonIcon } from "lucide-react";
import { useState } from "react";

import { LoginForm } from "@/components/login-form";
import { SignUpForm } from "@/components/sign-up-form";

export const Route = createFileRoute("/login")({
  component: RouteComponent,
});

function RouteComponent() {
  const [showSignIn, setShowSignIn] = useState(true);

  return (
    // `min-h-full` rather than a fixed height: the sign-up card is a field
    // taller than the sign-in card, and on a short viewport a fixed height
    // clipped it instead of letting the page scroll.
    <div className="flex min-h-full items-center justify-center px-6 py-10">
      <div className="w-full max-w-sm">
        {/* The wordmark is the only thing identifying this screen. Without it
            the page is an unlabelled card on a black field, and the app's
            first impression is a form from no one in particular. */}
        <div className="mb-7 flex items-center justify-center gap-2">
          <HexagonIcon className="size-5 text-primary" aria-hidden />
          <span className="font-display text-base font-semibold uppercase tracking-[0.08em]">
            Wherehouse
          </span>
        </div>

        {showSignIn ? (
          <LoginForm onSwitchToSignUp={() => setShowSignIn(false)} />
        ) : (
          <SignUpForm onSwitchToSignIn={() => setShowSignIn(true)} />
        )}
      </div>
    </div>
  );
}
