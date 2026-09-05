import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@wherehouse/ui/components/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@wherehouse/ui/components/card";
import {
  Field,
  FieldDescription,
  FieldError,
  FieldGroup,
  FieldLabel,
} from "@wherehouse/ui/components/field";
import { Input } from "@wherehouse/ui/components/input";
import { cn } from "@wherehouse/ui/lib/utils";
import { toast } from "sonner";
import z from "zod";

import { authClient } from "@/lib/auth-client";

import { authForm } from "./auth-form-styles";
import GoogleSignInButton from "./google-sign-in-button";
import Loader from "./loader";

export function LoginForm({
  onSwitchToSignUp,
  className,
  ...props
}: React.ComponentProps<"div"> & { onSwitchToSignUp: () => void }) {
  const navigate = useNavigate({
    from: "/",
  });
  const { isPending } = authClient.useSession();

  const form = useForm({
    defaultValues: {
      email: "",
      password: "",
    },
    onSubmit: async ({ value }) => {
      await authClient.signIn.email(
        {
          email: value.email,
          password: value.password,
        },
        {
          onSuccess: () => {
            navigate({
              to: "/dashboard",
            });
            toast.success("Sign in successful");
          },
          onError: (error) => {
            toast.error(error.error.message || error.error.statusText);
          },
        },
      );
    },
    validators: {
      onSubmit: z.object({
        email: z.email("Invalid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
      }),
    },
  });

  if (isPending) {
    return <Loader />;
  }

  return (
    <div className={cn("flex flex-col gap-6", className)} {...props}>
      <Card className={authForm.card}>
        <CardHeader>
          <CardTitle className={authForm.title}>Login to your account</CardTitle>
          <CardDescription className={authForm.description}>
            Enter your email below to login to your account
          </CardDescription>
        </CardHeader>
        <CardContent>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              e.stopPropagation();
              form.handleSubmit();
            }}
          >
            <FieldGroup className={authForm.fieldGroup}>
              <form.Field name="email">
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <FieldLabel className={authForm.label} htmlFor={field.name}>
                      Email
                    </FieldLabel>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="email"
                      placeholder="m@example.com"
                      className={authForm.input}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldError className={authForm.error} errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>

              <form.Field name="password">
                {(field) => (
                  <Field data-invalid={field.state.meta.errors.length > 0 || undefined}>
                    <div className="flex items-center">
                      <FieldLabel className={authForm.label} htmlFor={field.name}>
                        Password
                      </FieldLabel>
                      <a
                        href="#"
                        className="ml-auto inline-block text-sm underline-offset-4 hover:underline"
                      >
                        Forgot your password?
                      </a>
                    </div>
                    <Input
                      id={field.name}
                      name={field.name}
                      type="password"
                      className={authForm.input}
                      value={field.state.value}
                      onBlur={field.handleBlur}
                      onChange={(e) => field.handleChange(e.target.value)}
                    />
                    <FieldError className={authForm.error} errors={field.state.meta.errors} />
                  </Field>
                )}
              </form.Field>

              <Field>
                <form.Subscribe
                  selector={(state) => ({
                    canSubmit: state.canSubmit,
                    isSubmitting: state.isSubmitting,
                  })}
                >
                  {({ canSubmit, isSubmitting }) => (
                    <Button
                      type="submit"
                      className={authForm.button}
                      disabled={!canSubmit || isSubmitting}
                    >
                      {isSubmitting ? "Submitting..." : "Login"}
                    </Button>
                  )}
                </form.Subscribe>

                <GoogleSignInButton label="Login with Google" className={authForm.button} />

                <FieldDescription className={cn("text-center", authForm.footnote)}>
                  Don&apos;t have an account?{" "}
                  <button
                    type="button"
                    onClick={onSwitchToSignUp}
                    className="underline underline-offset-4"
                  >
                    Sign up
                  </button>
                </FieldDescription>
              </Field>
            </FieldGroup>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
