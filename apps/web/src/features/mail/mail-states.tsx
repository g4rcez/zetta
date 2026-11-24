import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import { Button } from "@/components/ui";
import { mailQueries, type Failure } from "./mail-api";

/** One quiet state: a sentence that says what is going on and one action. No illustration. */
export function StateBox({
  title,
  children,
  action,
  role = "status",
}: {
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  role?: "status" | "alert";
}) {
  return (
    <div role={role} className="flex flex-col items-start gap-3 p-6 text-sm">
      <h2 className="text-base font-medium text-balance">{title}</h2>
      {children && <div className="max-w-prose text-pretty text-muted-foreground">{children}</div>}
      {action}
    </div>
  );
}

export function ConnectLink({ label = "Connect a mailbox" }: { label?: string }) {
  return (
    <Link
      to="/mail/new"
      className="inline-flex h-8 items-center rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
    >
      {label}
    </Link>
  );
}

export function NoMailbox() {
  return (
    <StateBox title="No mailbox yet" action={<ConnectLink />}>
      Connect an e-mail address to read its inbox here. Nothing is moved, deleted or marked as read,
      and mail is sent only when you ask a bot to.
    </StateBox>
  );
}

/** Why a read failed, in plain words, with the one thing to do about it. */
export function ReadFailure({
  failure,
  mailboxId,
  onRetry,
  what,
}: {
  failure: Failure;
  mailboxId: string;
  onRetry: () => void;
  /** What was being read: "the inbox" or "this conversation". */
  what: string;
}) {
  // The mailbox list is already loaded by every page that shows a read failure; it tells which kind of mailbox this is.
  const kind = useQuery(mailQueries.mailboxes()).data?.find((m) => m.id === mailboxId)?.kind;
  if (failure.kind === "needs_auth" && (kind === "google" || kind === "microsoft")) {
    const name = kind === "google" ? "Google" : "Microsoft";
    return (
      <StateBox
        title={`${name} access needs to be signed in again`}
        role="alert"
        action={
          <Link
            to="/plugins/$pluginId"
            params={{ pluginId: kind }}
            className="inline-flex h-8 items-center rounded-md border border-field px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Open the {name} plugin
          </Link>
        }
      >
        Zetta reads this mailbox through your {name} connection, with no password of its own.{" "}
        {failure.message}
      </StateBox>
    );
  }
  if (failure.kind === "needs_auth")
    return (
      <StateBox
        title="The mail server did not accept the password"
        role="alert"
        action={
          <Link
            to="/mail/$mailboxId/settings"
            params={{ mailboxId }}
            className="inline-flex h-8 items-center rounded-md border border-field px-3 text-sm font-medium focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
          >
            Change the password
          </Link>
        }
      >
        It may have been changed or turned off. Enter it again in the settings of this mailbox.
      </StateBox>
    );
  if (failure.kind === "not_found")
    return (
      <StateBox title="This conversation can no longer be found">
        It may have been moved or deleted on the mail server.
      </StateBox>
    );
  return (
    <StateBox
      role="alert"
      title={failure.kind === "rate_limited" ? "Too many requests" : `Could not read ${what}`}
      action={
        <Button type="button" size="sm" variant="outline" onClick={onRetry}>
          Retry
        </Button>
      }
    >
      {failure.message}
    </StateBox>
  );
}
