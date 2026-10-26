import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import z from "zod";

import { AuthField } from "@/features/identity/auth-field";
import { getIdentityError, identityClient } from "@/lib/identity-client";

export default function SignUpForm({
  onSwitchToSignIn,
  onAuthenticated,
}: {
  onSwitchToSignIn: () => void;
  onAuthenticated: (invitationToken: string) => Promise<void>;
}) {
  const [error, setError] = useState<string | null>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  const form = useForm({
    defaultValues: { email: "", password: "", name: "", invitationToken: "" },
    validators: {
      onSubmit: z.object({
        name: z.string().min(2, "Name must be at least 2 characters"),
        email: z.email("Enter a valid email address"),
        password: z.string().min(8, "Password must be at least 8 characters"),
        invitationToken: z.string().trim().min(1, "Enter your invitation token"),
      }),
    },
    onSubmit: async ({ value }) => {
      setError(null);
      try {
        await identityClient.signUp({ ...value, invitationToken: value.invitationToken.trim() });
        await onAuthenticated(value.invitationToken.trim());
      } catch (failure) {
        setError(getIdentityError(failure));
      }
    },
  });
  return (
    <section className="mx-auto mt-16 w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-sm">
      <div className="space-y-3">
        <h1 ref={heading} tabIndex={-1} className="text-center text-3xl font-semibold tracking-tight outline-none">
          Create account
        </h1>
        <p className="text-sm text-muted-foreground">
          An invitation from the installation operator is required. Use the email address your
          invitation was issued for.
        </p>
      </div>
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
              <form.Field name="name">
                {(field) => (
                  <AuthField
                    id="signup-name"
                    name={field.name}
                    label="Name"
                    autoComplete="name"
                    required
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    errors={field.state.meta.errors.map((issue) => issue?.message)}
                  />
                )}
              </form.Field>
              <form.Field name="email">
                {(field) => (
                  <AuthField
                    id="signup-email"
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
                    id="signup-password"
                    name={field.name}
                    label="Password"
                    type="password"
                    autoComplete="new-password"
                    minLength={8}
                    required
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    errors={field.state.meta.errors.map((issue) => issue?.message)}
                  />
                )}
              </form.Field>
              <form.Field name="invitationToken">
                {(field) => (
                  <AuthField
                    id="signup-invitation"
                    name={field.name}
                    label="Invitation token"
                    type="password"
                    autoComplete="off"
                    spellCheck={false}
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
                {pending ? "Creating account…" : "Create account with invitation"}
              </Button>
              <p role="status" className="sr-only">
                {pending ? "Creating your account and checking membership." : ""}
              </p>
              <Button
                type="button"
                variant="link"
                className="h-auto w-full whitespace-normal"
                onClick={onSwitchToSignIn}
              >
                Already have an account? Sign in
              </Button>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
    </section>
  );
}
