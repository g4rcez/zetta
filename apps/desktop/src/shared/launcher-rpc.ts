import type { RPCSchema } from "electrobun/bun";
import type { DiscoverResult } from "../bun/discovery";
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
    };
    messages: Record<string, never>;
  }>;
  webview: RPCSchema<{
    requests: Record<string, never>;
    messages: { serversChanged: ServerEntry[]; promptAdd: string };
  }>;
};
