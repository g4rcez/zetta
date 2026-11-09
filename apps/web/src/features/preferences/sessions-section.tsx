import { Alert } from "@g4rcez/components/alert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { toast } from "@/lib/notify";

import { authClient } from "@/lib/auth-client";
import { errorMessage } from "../chat/chat-client";
import { relativeTime } from "../shared/relative-time";
import { ConfirmButton } from "../shared/ui";
import { describeDevice } from "./device";
import { PairPhoneCard } from "./pair-phone-card";
import { profileQueries } from "./profile-api";
import { Section } from "./section";

/** Where the person is signed in, and a way to end every other session. */
export function SessionsSection() {
  const qc = useQueryClient();
  const sessions = useQuery(profileQueries.sessions());
  const others = sessions.data?.filter((s) => s.device === "other").length ?? 0;

  async function signOutOthers() {
    const { error } = await authClient.revokeOtherSessions();
    if (error) return void toast.error("Could not sign out the other devices. Try again.");
    toast.success("Other devices signed out.");
    await qc.invalidateQueries({ queryKey: ["profile", "sessions"] });
  }

  return (
    <Section id="sessions" title="Sessions" description="The devices where you are signed in.">
      {sessions.isError ? (
        <Alert theme="danger">
          {errorMessage(sessions.error, "Could not load your sessions.")}
        </Alert>
      ) : !sessions.data ? (
        <p className="text-sm text-muted-foreground">Loading…</p>
      ) : (
        <ul aria-label="Your sessions" className="divide-y border-y">
          {sessions.data.map((s) => (
            <li key={s.id} className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 text-sm">
              <strong className="font-medium">{describeDevice(s.userAgent)}</strong>
              {s.device === "this" && (
                <span className="rounded-sm bg-primary/10 px-2 text-xs font-medium text-primary">
                  This device
                </span>
              )}
              <span className="text-xs text-muted-foreground">
                {s.ipAddress ?? "Unknown address"} · Signed in {relativeTime(s.createdAt)}
              </span>
            </li>
          ))}
        </ul>
      )}
      {others > 0 && (
        <ConfirmButton
          label="Sign out other devices"
          question="Sign out every other device? They will need to sign in again."
          confirmLabel="Sign out"
          onConfirm={signOutOthers}
        />
      )}
      <PairPhoneCard />
    </Section>
  );
}
