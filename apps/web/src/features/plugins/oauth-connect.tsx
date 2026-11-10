import { useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { pluginsApi, type PluginTest } from "./plugins-api";

/** Plugins with their own sign-in panel; every other OAuth plugin gets the generic one below. */
export const CUSTOM_OAUTH = new Set(["google", "reddit", "composio"]);

/**
 * Connect / Disconnect for a plugin that signs in with OAuth through the shared server flow (integrations/plugins/oauth2.ts): the
 * client id and secret are the plugin's settings above, Connect opens the service's consent page, and it comes back here.
 */
export function OAuthConnect({
  pluginId,
  name,
  probe,
  onChanged,
  onError,
}: {
  pluginId: string;
  name: string;
  probe?: PluginTest | undefined;
  onChanged: () => void;
  onError: (m: string) => void;
}) {
  const [busy, setBusy] = useState(false);
  const connected = probe?.status.state === "connected";
  const account = (probe?.status.info as { account?: unknown } | undefined)?.account;
  async function connect() {
    setBusy(true);
    try {
      const r = await pluginsApi.connect(pluginId, {});
      if (r.authorizeUrl) {
        window.location.assign(r.authorizeUrl);
        return;
      }
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  async function disconnect() {
    setBusy(true);
    try {
      await pluginsApi.disconnect(pluginId);
      onChanged();
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  }
  return (
    <div className="flex flex-wrap items-center gap-3 text-sm">
      <span className="text-muted-foreground">
        {connected
          ? `Connected${typeof account === "string" && account ? ` as ${account}` : ""}.`
          : `Not connected. Save the client ID and secret above, then connect your ${name} account.`}
      </span>
      {connected ? (
        <Button size="sm" variant="outline" disabled={busy} onClick={() => void disconnect()}>
          Disconnect
        </Button>
      ) : (
        <Button size="sm" disabled={busy} onClick={() => void connect()}>
          Connect {name}
        </Button>
      )}
    </div>
  );
}
