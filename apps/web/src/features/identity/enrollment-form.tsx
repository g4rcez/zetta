import { Button, Input } from "@/components/ui";
import { useEffect, useRef } from "react";

export function EnrollmentForm({
  token,
  onTokenChange,
  onAccept,
  onRetry,
  onSignOut,
  pending,
  error,
}: {
  token: string;
  onTokenChange: (token: string) => void;
  onAccept: () => Promise<void>;
  onRetry: () => Promise<void>;
  onSignOut: () => Promise<void>;
  pending: boolean;
  error: string | null;
}) {
  const heading = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    heading.current?.focus();
  }, []);
  return (
    <section className="mx-auto mt-16 w-full max-w-md space-y-6 rounded-xl border bg-card p-8 shadow-sm" aria-busy={pending}>
      <h1 className="text-2xl font-semibold outline-none" tabIndex={-1} ref={heading}>
        Join this installation
      </h1>
      <p className="text-sm text-muted-foreground">
        You are signed in, but this account has no active membership. Paste your invitation or ask
        the installation operator for one.
      </p>
      <form
        className="space-y-4"
        onSubmit={(event) => {
          event.preventDefault();
          if (!pending) void onAccept();
        }}
      >
        <div className="space-y-2">
          <Input
            title="Invitation token"
            id="enrollment-token"
            type="password"
            autoComplete="off"
            spellCheck={false}
            value={token}
            onChange={(event) => onTokenChange(event.target.value)}
            required
            disabled={pending}
          />
        </div>
        <Button type="submit" className="w-full" disabled={pending || !token.trim()}>
          {pending ? "Checking membership…" : "Accept invitation"}
        </Button>
      </form>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
      <p role="status" className="text-sm">
        {pending
          ? "Please wait for the current request."
          : "Already accepted an invitation? Check your status."}
      </p>
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" disabled={pending} onClick={() => void onRetry()}>
          Check status
        </Button>
        <Button variant="ghost" disabled={pending} onClick={() => void onSignOut()}>
          Sign out
        </Button>
      </div>
    </section>
  );
}
