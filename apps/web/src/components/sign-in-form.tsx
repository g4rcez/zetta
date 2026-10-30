import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import z from "zod";

import { Logo } from "@/components/logo";
import { AuthField } from "@/features/identity/auth-field";
import { isAppUrl, signedOAuthQuery } from "@/features/identity/oauth";
import { authClient } from "@/lib/auth-client";

export default function SignInForm({
  onSwitchToSignUp,
  onAuthenticated,
}: {
  onSwitchToSignUp: () => void;
  onAuthenticated: () => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const navigate = useNavigate();
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const form = useForm({
    defaultValues: { email: "", password: "" },
    validators: {
      onSubmit: z.object({
        email: z.email("Enter a valid email address"),
        password: z.string().min(1, "Enter your password"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        const oauthQuery = signedOAuthQuery();
        const result = await authClient.signIn.email({
          ...value,
          ...(oauthQuery && { oauth_query: oauthQuery }),
        });
        if (result.error) {
          setError("Could not sign in. Check your email and password and try again.");
          return;
        }
        // Signing in for an MCP client: the API answers with the next step (consent here, or the client's callback).
        const next = oauthQuery ? (result.data as { url?: string } | null)?.url : undefined;
        if (next) {
          if (isAppUrl(next)) {
            const url = new URL(next);
            await navigate({ href: url.pathname + url.search, replace: true });
          } else window.location.assign(next);
          return;
        }
        await onAuthenticated();
      } catch {
        setError("Could not connect to sign in. Check your connection and try again.");
      }
    },
  });
  return (
    <section className="mx-auto mt-16 w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-sm">
      <Logo size={72} className="mx-auto" />
      <h1
        ref={heading}
        tabIndex={-1}
        className="text-center text-3xl font-semibold tracking-tight outline-none"
      >
        Welcome back
      </h1>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <fieldset disabled={pending} className="space-y-4" aria-busy={pending}>
              <form.Field name="email">
                {(field) => (
                  <AuthField
                    id="signin-email"
                    name={field.name}
                    label="Email"
                    type="email"
                    autoComplete="username"
                    required
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    errors={field.state.meta.errors.map((issue) => issue?.message)}
                  />
                )}
              </form.Field>
              <form.Field name="password">
                {(field) => (
                  <AuthField
                    id="signin-password"
                    name={field.name}
                    label="Password"
                    type="password"
                    autoComplete="current-password"
                    required
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    errors={field.state.meta.errors.map((issue) => issue?.message)}
                  />
                )}
              </form.Field>
              {error && (
                <p role="alert" className="text-sm text-destructive">
                  {error}
                </p>
              )}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </Button>
              <p role="status" className="sr-only">
                {pending ? "Signing in and checking membership." : ""}
              </p>
              <Button
                type="button"
                variant="link"
                className="h-auto w-full whitespace-normal"
                onClick={onSwitchToSignUp}
              >
                Have an invitation? Create an account
              </Button>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}
