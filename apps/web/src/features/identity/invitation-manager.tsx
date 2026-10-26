import { useForm } from "@tanstack/react-form";
import { Button, Input } from "@/components/ui";
import { useEffect, useRef, useState } from "react";
import z from "zod";

import { getIdentityError, identityClient, type IssuedInvitation } from "@/lib/identity-client";

import { AuthField } from "./auth-field";

type DisplayedInvitation = Omit<IssuedInvitation, "token"> & { token: string | null };

export function InvitationManager() {
  const [invitation, setInvitation] = useState<DisplayedInvitation | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [feedback, setFeedback] = useState("");
  const [revoking, setRevoking] = useState(false);
  const resultHeading = useRef<HTMLHeadingElement>(null);
  const issueHeading = useRef<HTMLHeadingElement>(null);
  const revokeButton = useRef<HTMLButtonElement>(null);
  const mutationInFlight = useRef(false);
  useEffect(() => {
    if (invitation?.token) resultHeading.current?.focus();
  }, [invitation?.token]);

  const form = useForm({
    defaultValues: { intendedEmail: "", intendedUserId: "" },
    validators: {
      onSubmit: z.object({
        intendedEmail: z.email("Enter the invited account's email address"),
        intendedUserId: z.string(),
      }),
    },
    onSubmit: async ({ value }) => {
      if (mutationInFlight.current || invitation) return;
      mutationInFlight.current = true;
      setError(null);
      setFeedback("");
      try {
        const userId = value.intendedUserId.trim();
        const result = await identityClient.issue({
          intendedEmail: value.intendedEmail,
          ...(userId ? { intendedUserId: userId } : {}),
        });
        setInvitation(result);
        setFeedback("Invitation created. Copy the token before hiding it.");
      } catch (failure) {
        setError(
          `${getIdentityError(failure)} If the response was lost, an invitation may have been created. Contact the installation operator before issuing another.`,
        );
      } finally {
        mutationInFlight.current = false;
      }
    },
  });

  async function revoke() {
    if (!invitation || mutationInFlight.current) return;
    mutationInFlight.current = true;
    setRevoking(true);
    setError(null);
    try {
      await identityClient.revoke(invitation.invitationId);
      setInvitation(null);
      setFeedback("Invitation revoked.");
      issueHeading.current?.focus();
    } catch (failure) {
      setError(getIdentityError(failure));
    } finally {
      mutationInFlight.current = false;
      setRevoking(false);
    }
  }

  async function copy() {
    if (!invitation?.token) return;
    try {
      await navigator.clipboard.writeText(invitation.token);
      setFeedback("Invitation token copied. Share it privately with the intended account.");
    } catch {
      setFeedback("Copy was unavailable. Select the token and copy it manually.");
    }
  }

  return (
    <section
      className="max-w-md space-y-5 border border-border p-4"
      aria-labelledby="invitations-heading"
    >
      <div className="space-y-2">
        <h2
          id="invitations-heading"
          ref={issueHeading}
          tabIndex={-1}
          className="text-lg font-semibold"
        >
          Invite a member
        </h2>
        <p className="text-sm text-muted-foreground">
          Invitations expire and can be used once by the intended account. Only the invitation shown
          here can be revoked from this screen.
        </p>
      </div>
      <form
        onSubmit={(event) => {
          event.preventDefault();
          void form.handleSubmit();
        }}
      >
        <form.Subscribe selector={(state) => state.isSubmitting}>
          {(pending) => (
            <fieldset
              disabled={pending || revoking || invitation !== null}
              className="space-y-4"
              aria-busy={pending}
            >
              <form.Field name="intendedEmail">
                {(field) => (
                  <AuthField
                    id="invited-email"
                    name={field.name}
                    label="Invited email"
                    type="email"
                    autoComplete="off"
                    required
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    errors={field.state.meta.errors.map((issue) => issue?.message)}
                  />
                )}
              </form.Field>
              <form.Field name="intendedUserId">
                {(field) => (
                  <AuthField
                    id="invited-user"
                    name={field.name}
                    label="Existing account ID (optional)"
                    autoComplete="off"
                    value={field.state.value}
                    onBlur={field.handleBlur}
                    onChange={(event) => field.handleChange(event.target.value)}
                    errors={field.state.meta.errors.map((issue) => issue?.message)}
                  />
                )}
              </form.Field>
              <Button type="submit" disabled={pending || revoking || invitation !== null}>
                {pending ? "Creating invitation…" : "Create invitation"}
              </Button>
            </fieldset>
          )}
        </form.Subscribe>
      </form>
      {invitation && (
        <div className="space-y-3 border-t border-border pt-4" aria-busy={revoking}>
          <h3 ref={resultHeading} tabIndex={-1} className="font-semibold">
            Invitation created
          </h3>
          <p className="break-all text-sm">Invitation ID: {invitation.invitationId}</p>
          <p className="text-sm">
            Expires:{" "}
            <time dateTime={invitation.expiresAt}>
              {new Date(invitation.expiresAt).toLocaleString()}
            </time>
          </p>
          {invitation.token ? (
            <>
              <p className="text-sm text-muted-foreground">
                This token is shown once. Share it privately. Hiding it or leaving this screen
                removes it from this view.
              </p>
              <Input
                title="Invitation token"
                id="issued-token"
                autoComplete="off"
                spellCheck={false}
                readOnly
                value={invitation.token}
                onFocus={(event) => event.target.select()}
              />
              <div className="flex flex-wrap gap-2">
                <Button variant="outline" disabled={revoking} onClick={() => void copy()}>
                  Copy token
                </Button>
                <Button
                  variant="ghost"
                  disabled={revoking}
                  onClick={() => {
                    setInvitation({ ...invitation, token: null });
                    setFeedback("Token hidden. You can still revoke this invitation.");
                    revokeButton.current?.focus();
                  }}
                >
                  Hide token
                </Button>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">
              Token hidden. Keep this screen open if you need to revoke this invitation.
            </p>
          )}
          <div className="flex flex-wrap gap-2">
            <Button
              ref={revokeButton}
              variant="destructive"
              disabled={revoking}
              onClick={() => void revoke()}
            >
              {revoking ? "Revoking…" : "Revoke invitation"}
            </Button>
            {!invitation.token && (
              <Button
                variant="outline"
                disabled={revoking}
                onClick={() => {
                  setInvitation(null);
                  setFeedback("Finished. You can create another invitation.");
                  issueHeading.current?.focus();
                }}
              >
                Finish
              </Button>
            )}
          </div>
        </div>
      )}
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <form.Subscribe selector={(state) => state.isSubmitting}>
        {(pending) => (
          <p role="status" className="text-sm">
            {pending
              ? "Creating an invitation. Please wait."
              : revoking
                ? "Revoking invitation. Please wait."
                : feedback}
          </p>
        )}
      </form.Subscribe>
    </section>
  );
}
