import { useForm } from "@tanstack/react-form";
import { Button } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import z from "zod";

import { AuthCard, AuthError } from "@/features/identity/auth-card";
import { AuthField } from "@/features/identity/auth-field";
import { getIdentityError, identityClient } from "@/lib/identity-client";

export default function SignUpForm({
  onSwitchToSignIn,
  onAuthenticated,
}: {
  onSwitchToSignIn: () => void;
  onAuthenticated: (invitationToken?: string) => Promise<void>;
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
    <AuthCard
      title="Create account"
      description="An invitation from the installation operator is required. Use the email address your invitation was issued for."
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
              {error && <AuthError>{error}</AuthError>}
              <Button type="submit" className="w-full" disabled={pending}>
                {pending ? "Creating account…" : "Create account with invitation"}
              </Button>
              <p role="status" className="sr-only">
                {pending ? "Creating your account and checking membership." : ""}
              </p>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
      <p className="border-t pt-6 text-center text-sm text-muted-foreground">
        Already have an account?{" "}
        <Button
          type="button"
          variant="link"
          className="inline-flex h-auto min-h-0 !p-0 align-baseline"
          onClick={onSwitchToSignIn}
        >
          Sign in
        </Button>
      </p>
    </AuthCard>
  );
}
