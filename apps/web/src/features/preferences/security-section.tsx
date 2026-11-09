import { useQueryClient } from "@tanstack/react-query";
import { Alert } from "@g4rcez/components/alert";
import { useState, type FormEvent } from "react";
import { toast } from "@/lib/notify";

import { Button, Checkbox, Input } from "@/components/ui";
import { authClient } from "@/lib/auth-client";
import { Section } from "./section";

const LIMITS = "Use 8 to 128 characters.";

/** What a person can do about each answer of the password endpoint. */
function passwordError(error: { code?: string; message?: string; status?: number }) {
  if (error.code === "INVALID_PASSWORD") return "Current password is incorrect.";
  if (error.code === "PASSWORD_TOO_SHORT" || error.code === "PASSWORD_TOO_LONG") return LIMITS;
  if (error.status === 429) return "Too many attempts. Try again in a few minutes.";
  return error.message || "Could not change the password.";
}

export function SecuritySection() {
  const qc = useQueryClient();
  const [current, setCurrent] = useState("");
  const [next, setNext] = useState("");
  const [confirm, setConfirm] = useState("");
  const [revoke, setRevoke] = useState(true);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (busy) return;
    setError(undefined);
    if (next.length < 8 || next.length > 128) return setError(LIMITS);
    if (next !== confirm) return setError("Passwords do not match.");
    setBusy(true);
    try {
      const { error: failed } = await authClient.changePassword({
        currentPassword: current,
        newPassword: next,
        revokeOtherSessions: revoke,
      });
      if (failed) return setError(passwordError(failed));
      setCurrent("");
      setNext("");
      setConfirm("");
      toast.success("Password changed.");
      await qc.invalidateQueries({ queryKey: ["profile", "sessions"] });
    } catch {
      // no-excuse-ok: catch -- show a fixed message at the user action boundary.
      setError("Could not change the password. Check your connection and try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <Section
      id="security"
      title="Security"
      description="Change your password. You need the current one."
    >
      <form onSubmit={(e) => void submit(e)} className="max-w-md space-y-3">
        <Input
          title="Current password"
          name="current-password"
          type="password"
          autoComplete="current-password"
          required
          value={current}
          onChange={(e) => setCurrent(e.target.value)}
        />
        <Input
          title="New password"
          name="new-password"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          maxLength={128}
          value={next}
          onChange={(e) => setNext(e.target.value)}
        />
        <Input
          title="Confirm new password"
          name="confirm-password"
          type="password"
          autoComplete="new-password"
          required
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />
        <label className="flex items-center gap-2 text-sm">
          <Checkbox checked={revoke} onChange={(e) => setRevoke(e.target.checked)} />
          Sign out my other devices
        </label>
        {error && <Alert theme="danger">{error}</Alert>}
        <Button type="submit" disabled={busy}>
          {busy ? "Changing…" : "Change password"}
        </Button>
      </form>
    </Section>
  );
}
