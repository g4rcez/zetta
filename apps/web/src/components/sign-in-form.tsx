import { useForm } from "@tanstack/react-form";
import { useNavigate } from "@tanstack/react-router";
import { Button } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import z from "zod";

import { AuthCard, AuthError } from "@/features/identity/auth-card";
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
    <AuthCard
      title="Welcome back"
      description="Sign in to your Zetta account."
      headingRef={heading}
    >
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <fieldset disabled={pending} className="flex flex-col gap-5" aria-busy={pending}>
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
              {error && <AuthError>{error}</AuthError>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Signing in…" : "Sign in"}
              </Button>
              <p role="status" className="sr-only">
                {pending ? "Signing in and checking membership." : ""}
              </p>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
      <p className="border-t pt-6 text-center text-sm text-muted-foreground">
        Have an invitation?{" "}
        <Button
          type="button"
          variant="link"
          className="inline-flex h-auto min-h-0 !p-0 align-baseline"
          onClick={onSwitchToSignUp}
        >
          Create an account
        </Button>
      </p>
    </AuthCard>
  );
}
