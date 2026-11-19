import type { RPCSchema } from "electrobun/bun";
import type { DiscoverResult } from "../bun/discovery";
import type { LocalState } from "../bun/local-server";
import type { PendingApproval } from "../bun/companion/approvals";
import type { CompanionState } from "../bun/companion/client";
import type { Decision } from "../bun/companion/policy";
import type { ConnectResult, LinkState } from "../bun/remote-link";

/** What the launcher shows about letting remote servers' bots use this computer. */
export type Sharing = {
  states: Record<string, CompanionState>;
  paused: boolean;
  pending: PendingApproval[];
};
import type { ServerEntry } from "../bun/registry";

/** `sharesCookiesWith`: names of the servers whose sign-in this one would overwrite (same host), so the launcher can say so. */
export type AddServerResult =
  | { status: "added"; server: ServerEntry; sharesCookiesWith: string[] }
  | Exclude<DiscoverResult, { status: "found" }>;

/** What the launcher page (views://launcher) and the main process say to each other. The launcher is the only page with this channel. */
export type LauncherRpc = {
  bun: RPCSchema<{
    requests: {
      listServers: { params: Record<string, never>; response: ServerEntry[] };
      addServer: { params: { address: string }; response: AddServerResult };
      openServer: { params: { id: string }; response: boolean };
      removeServer: { params: { id: string }; response: boolean };
      /** The server this app runs on this computer; `null` when the app was built without one or it is turned off. */
      localState: { params: Record<string, never>; response: LocalState | null };
      startLocal: { params: Record<string, never>; response: LocalState | null };
      stopLocal: { params: Record<string, never>; response: LocalState | null };
      /** How each remote server stands: signed in or not, and whether this computer's own server can use it. */
      linkStates: { params: Record<string, never>; response: Record<string, LinkState> };
      /** Signs in to a remote server in the system browser. Resolves when the person is back, refused or gave up. */
      connectRemote: { params: { id: string }; response: ConnectResult };
      disconnectRemote: { params: { id: string }; response: boolean };
      sharing: { params: Record<string, never>; response: Sharing };
      /** Lets (or stops letting) a server's bots use this computer. Turning it on pairs the computer first; false when the server refused. */
      shareComputer: { params: { id: string; on: boolean }; response: boolean };
      decideApproval: { params: { id: string; decision: Decision }; response: boolean };
      setSharingPaused: { params: { paused: boolean }; response: boolean };
      /** Shows the server's log file in the file manager. */
      showLocalLog: { params: Record<string, never>; response: boolean };
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: {
      serversChanged: ServerEntry[];
      promptAdd: string;
      localChanged: LocalState;
      linksChanged: Record<string, LinkState>;
      sharingChanged: Sharing;
    };
  }>;
};
