import {
  authorize,
  discoverEndpoints,
  needsRefresh,
  OAuthError,
  refresh,
  revoke,
  type Fetcher,
  type OAuthEndpoints,
  type Tokens,
} from "./oauth";
import type { Registry, ServerEntry } from "./registry";
import type { TokenStore } from "./token-store";

/**
 * Where a remote server stands for this app.
 * - `disconnected`: the app has no sign-in there.
 * - `connected`: signed in; the local server (when it runs) has a way into the remote.
 * - `signin-needed`: the tokens were refused (revoked, or expired with no way to renew): sign in again.
 */
export type LinkStatus = "disconnected" | "connected" | "signin-needed";
export type LinkState = {
  status: LinkStatus;
  /** True when the local server holds the current token; false while it is not running or has no owner yet; null when not connected. */
  localLinked: boolean | null;
  connectedAt: string | null;
};
export type ConnectResult =
  | { status: "connected" }
  | { status: "failed"; error: OAuthError["code"] | "NOT_REMOTE" | "UNKNOWN" };

/** How the app reaches its own server's link routes. */
export type LocalLinkTarget = { origin: string; token: string };

export type RemoteLinkDeps = {
  registry: Registry;
  tokens: TokenStore;
  /** Opens an address in the person's browser. */
  open(url: string): void;
  /** The local server's address and link secret, or null while it is not running. */
  local(): LocalLinkTarget | null;
  fetcher?: Fetcher;
  clientId?: string;
  now?: () => number;
  /** Replaceable pieces, for tests. */
  discover?: typeof discoverEndpoints;
  authorize?: typeof authorize;
  refresh?: typeof refresh;
  revoke?: typeof revoke;
  onChange?: () => void;
};

export function createRemoteLink(deps: RemoteLinkDeps) {
  const { registry, tokens, fetcher = fetch, now = Date.now } = deps;
  const discover = deps.discover ?? discoverEndpoints;
  const doAuthorize = deps.authorize ?? authorize;
  const doRefresh = deps.refresh ?? refresh;
  const doRevoke = deps.revoke ?? revoke;
  /** Servers whose tokens the remote refused: signed in once, now needing a new sign-in. */
  const expired = new Set<string>();
  /** Servers whose current access token the local server holds. */
  const pushed = new Map<string, string>();
  let timer: ReturnType<typeof setInterval> | undefined;

  const changed = () => deps.onChange?.();
  const entryOf = (id: string): ServerEntry | undefined => {
    const entry = registry.get(id);
    return entry && entry.kind === "remote" ? entry : undefined;
  };
  const endpointsOf = (entry: ServerEntry): Promise<OAuthEndpoints> =>
    discover({ webOrigin: entry.webOrigin, apiOrigin: entry.apiOrigin }, fetcher);

  async function callLocal(
    method: "PUT" | "DELETE",
    body: Record<string, string>,
  ): Promise<"ok" | "not-ready" | "unavailable"> {
    const target = deps.local();
    if (!target) return "unavailable";
    try {
      const res = await fetcher(`${target.origin}/api/desktop/remotes`, {
        method,
        headers: { "content-type": "application/json", "x-zetta-desktop-link": target.token },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(10_000),
      });
      if (res.ok) return "ok";
      return res.status === 409 ? "not-ready" : "unavailable";
    } catch {
      return "unavailable";
    }
  }

  /** Gives the local server the current access token of one remote. Remembers what it holds, so a token is sent once. */
  async function push(entry: ServerEntry, current: Tokens): Promise<boolean> {
    if (pushed.get(entry.id) === current.accessToken) return true;
    const result = await callLocal("PUT", {
      origin: entry.apiOrigin,
      accessToken: current.accessToken,
    });
    if (result === "ok") pushed.set(entry.id, current.accessToken);
    return result === "ok";
  }

  async function connect(id: string): Promise<ConnectResult> {
    const entry = entryOf(id);
    if (!entry) return { status: "failed", error: "NOT_REMOTE" };
    try {
      const endpoints = await endpointsOf(entry);
      const signedIn = await doAuthorize({
        endpoints,
        clientId: deps.clientId,
        open: deps.open,
        fetcher,
        now,
      });
      tokens.set(entry.id, signedIn);
      expired.delete(entry.id);
      pushed.delete(entry.id);
      await push(entry, signedIn);
      changed();
      return { status: "connected" };
    } catch (error) {
      return { status: "failed", error: error instanceof OAuthError ? error.code : "UNKNOWN" };
    }
  }

  async function disconnect(id: string): Promise<boolean> {
    const stored = tokens.get(id);
    const entry = registry.get(id);
    if (!stored) return false;
    if (entry) {
      // The local server drops its copy first, then the remote is told the tokens are no longer wanted. Both are best effort: the app's own
      // copy is removed whatever the network says.
      await callLocal("DELETE", { origin: entry.apiOrigin });
      try {
        await doRevoke({
          endpoints: await endpointsOf(entry),
          tokens: stored.tokens,
          clientId: deps.clientId,
          fetcher,
        });
      } catch {}
    }
    tokens.remove(id);
    expired.delete(id);
    pushed.delete(id);
    changed();
    return true;
  }

  /** Renews what is about to end and hands current tokens to the local server. Run on a timer, and when the local server comes up. */
  async function tick(): Promise<void> {
    let any = false;
    for (const id of tokens.ids()) {
      const entry = entryOf(id);
      const stored = tokens.get(id);
      if (!entry || !stored) continue;
      let current = stored.tokens;
      if (needsRefresh(current, now())) {
        try {
          current = await doRefresh({
            endpoints: await endpointsOf(entry),
            tokens: current,
            clientId: deps.clientId,
            fetcher,
            now,
          });
          tokens.set(id, current);
          expired.delete(id);
          any = true;
        } catch (error) {
          // A refusal means sign in again; a network failure only means try again at the next tick.
          if (
            error instanceof OAuthError &&
            (error.code === "REFRESH_FAILED" || error.code === "NO_REFRESH")
          ) {
            if (!expired.has(id)) any = true;
            expired.add(id);
          }
          continue;
        }
      }
      const before = pushed.get(id);
      if (await push(entry, current)) any ||= before !== current.accessToken;
    }
    if (any) changed();
  }

  return {
    state(id: string): LinkState {
      const stored = tokens.get(id);
      if (!stored) return { status: "disconnected", localLinked: null, connectedAt: null };
      return {
        status: expired.has(id) ? "signin-needed" : "connected",
        localLinked: pushed.get(id) === stored.tokens.accessToken,
        connectedAt: stored.connectedAt,
      };
    },
    states(): Record<string, LinkState> {
      return Object.fromEntries(
        registry
          .list()
          .filter((e) => e.kind === "remote")
          .map((e) => [e.id, this.state(e.id)]),
      );
    },
    connect,
    disconnect,
    /** An access token that is good now (renewed first when it is about to end), or null when signed out or the renewal was refused. */
    async freshAccessToken(id: string): Promise<string | null> {
      const stored = tokens.get(id);
      const entry = entryOf(id);
      if (!stored || !entry) return null;
      if (!needsRefresh(stored.tokens, now())) return stored.tokens.accessToken;
      try {
        const next = await doRefresh({
          endpoints: await endpointsOf(entry),
          tokens: stored.tokens,
          clientId: deps.clientId,
          fetcher,
          now,
        });
        tokens.set(id, next);
        return next.accessToken;
      } catch {
        return null;
      }
    },
    tick,
    /** Forget what the local server holds (it restarted): the next tick sends the tokens again. */
    localRestarted() {
      pushed.clear();
      changed();
    },
    /** Keeps tokens fresh. Returns what stops it. */
    start(everyMs = 60_000): () => void {
      timer = setInterval(() => void tick(), everyMs);
      (timer as { unref?: () => void }).unref?.();
      void tick();
      return () => clearInterval(timer);
    },
  };
}

export type RemoteLink = ReturnType<typeof createRemoteLink>;
