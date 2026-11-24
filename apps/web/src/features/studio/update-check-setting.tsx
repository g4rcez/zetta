import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { Checkbox } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { identityQueries } from "../identity/identity-queries";
import { installationApi, installationQueries } from "../onboarding/installation-api";
import { updatesQueries } from "../updates/updates-api";

/**
 * "Check for updates": whether the server looks once a day for a newer version. Only an administrator changes it, and it is saved at once.
 * It sits with the other server settings (Studio > Server settings, and the installation form the Chief opens).
 */
export function UpdateCheckSetting({ onError }: { onError: (message: string) => void }) {
  const qc = useQueryClient();
  const { data: saved } = useQuery(installationQueries.get());
  const { data: identity } = useQuery(identityQueries.status());
  const { data: version } = useQuery(updatesQueries.version());
  const admin = identity?.state === "active" && identity.isAdmin;
  const [busy, setBusy] = useState(false);
  const on = saved?.updateCheck !== "off";
  // The operator can turn the check off for the whole server (ZETTA_UPDATE_CHECK=off): the setting then has no effect, and it says so.
  const operatorOff = on && version?.check === "off";
  async function toggle(next: boolean) {
    setBusy(true);
    try {
      await installationApi.patch({ updateCheck: next ? "on" : "off" });
      await qc.invalidateQueries({ queryKey: updatesQueries.version().queryKey });
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <section aria-label="Updates" className="space-y-2 rounded-xl border bg-card p-5">
      <Checkbox
        checked={on}
        disabled={!admin || busy || saved === undefined}
        onChange={(e) => void toggle(e.target.checked)}
      >
        Check for updates
      </Checkbox>
      <p className="text-sm text-pretty text-muted-foreground">
        Once a day Zetta reads the public list of changes at zettabot.app to learn whether a newer
        version exists, and tells the administrator. It is one plain request that carries nothing
        about this installation: no name, no address, no identifier. Turn it off and nothing is
        sent.
      </p>
      {operatorOff && (
        <p role="note" className="text-xs text-muted-foreground">
          The person who runs the server turned the check off for the whole server, so this setting
          has no effect.
        </p>
      )}
    </section>
  );
}
