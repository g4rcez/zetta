import {
  compareToFeed,
  parseFeed,
  type BuildInfo,
  type UpdateChange,
  type UpdateCheckMode,
  type UpdateState,
} from "@zetta/core/update-check";

/** The published changelog of the landing site (apps/landing/src/pages/changelog.json.ts). */
export const DEFAULT_UPDATE_FEED = "https://zettabot.app/changelog.json";

const TIMEOUT_MS = 5000;
/** The feed is about 25 KB today; anything over this is not it. */
const MAX_BYTES = 512 * 1024;
const MAX_HOPS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;
/** After a failed check the next try waits this long. */
const RETRY_MS = 60 * 60 * 1000;

export type UpdateStatus = {
  build: BuildInfo | null;
  state: UpdateState;
  latest: { date: string } | null;
  changes: UpdateChange[];
  /** When the feed was last read successfully (ISO 8601), or null. */
  checkedAt: string | null;
  /** `off` when the administrator or the operator turned the check off: nothing is sent. */
  check: UpdateCheckMode;
};

/** What the check found, for the one who raises the Catch up card. `null`: the check is off, so there is nothing to say. */
export type UpdateVerdict = { state: UpdateState; latest: { date: string } | null } | null;

export type UpdateCheckerDeps = {
  build: BuildInfo | null;
  /** The address of the feed: the fixed public one unless the operator set `ZETTA_UPDATE_FEED`. */
  feedUrl?: string;
  /** `ZETTA_UPDATE_CHECK=off`: the operator's switch. It wins over the installation setting. */
  operatorOff?: boolean;
  /** The installation setting `updateCheck`. */
  mode: () => Promise<UpdateCheckMode>;
  fetch?: typeof fetch;
  now?: () => number;
  /** Lifts the private-network check for an address the operator chose (ZETTA_ALLOW_PRIVATE_NETWORK). */
  allowPrivate?: boolean;
  /** Refuses (throws) an address on a private network. Only used for an address other than the default. */
  assertPublic?: (url: string) => Promise<void>;
  /** After a check finished, or when it was found off. The server raises or closes the administrator's card here. */
  onVerdict?: (verdict: UpdateVerdict) => Promise<void>;
  /** A process that never runs the ticker (the `api` role) checks when asked, at most once a day. */
  lazy?: boolean;
};

class FeedError extends Error {}

/** One plain GET: no body, no cookies, no identifier. Follows at most three redirects, each one checked like the first. */
async function readFeed(
  url: string,
  d: Required<Pick<UpdateCheckerDeps, "fetch">> &
    Pick<UpdateCheckerDeps, "assertPublic" | "allowPrivate">,
  guarded: boolean,
): Promise<unknown> {
  let target = url;
  for (let hop = 0; hop <= MAX_HOPS; hop++) {
    const u = new URL(target);
    if (u.protocol !== "https:" && !(d.allowPrivate && u.protocol === "http:"))
      throw new FeedError("not https");
    if (guarded && !d.allowPrivate && d.assertPublic) await d.assertPublic(target);
    const res = await d.fetch(target, {
      method: "GET",
      headers: { accept: "application/json" },
      redirect: "manual",
      credentials: "omit",
      signal: AbortSignal.timeout(TIMEOUT_MS),
    });
    if (res.status >= 300 && res.status < 400) {
      const next = res.headers.get("location");
      if (!next) throw new FeedError("redirect without a location");
      target = new URL(next, target).toString();
      continue;
    }
    if (!res.ok) throw new FeedError(`status ${res.status}`);
    const length = Number(res.headers.get("content-length") ?? 0);
    if (length > MAX_BYTES) throw new FeedError("too large");
    const text = await readCapped(res);
    return JSON.parse(text);
  }
  throw new FeedError("too many redirects");
}

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_BYTES) {
      await reader.cancel();
      throw new FeedError("too large");
    }
    chunks.push(value);
  }
  return new TextDecoder().decode(Buffer.concat(chunks));
}

/**
 * The daily "is there a newer version" check. It reads the landing site's `changelog.json` with one plain GET and compares the newest day
 * with the day of the build. Nothing about the installation is sent. The last result is kept in memory (there is no storage for it
 * without a migration), so a restart checks again at once. It never throws: any failure leaves the last good result in place.
 */
export function createUpdateChecker(deps: UpdateCheckerDeps) {
  const now = deps.now ?? Date.now;
  const doFetch = deps.fetch ?? fetch;
  const feedUrl = deps.feedUrl?.trim() || DEFAULT_UPDATE_FEED;
  const guarded = feedUrl !== DEFAULT_UPDATE_FEED;
  let last:
    | { state: UpdateState; latest: { date: string } | null; changes: UpdateChange[] }
    | undefined;
  let checkedAt: number | undefined;
  /** When the next check is due: a day after a good one, an hour after a failed one. */
  let nextAt: number | undefined;
  let running: Promise<void> | undefined;
  let offHandled = false;

  const isOff = async (): Promise<boolean> =>
    deps.operatorOff === true || (await deps.mode().catch(() => "on" as const)) === "off";

  async function announce(verdict: UpdateVerdict) {
    try {
      await deps.onVerdict?.(verdict);
    } catch {
      // A card that cannot be raised now is raised by the next check.
    }
  }

  async function run() {
    nextAt = now() + RETRY_MS;
    try {
      const feed = parseFeed(
        await readFeed(
          feedUrl,
          { fetch: doFetch, assertPublic: deps.assertPublic, allowPrivate: deps.allowPrivate },
          guarded,
        ),
      );
      const verdict = compareToFeed(deps.build, feed);
      last = verdict;
      checkedAt = now();
      nextAt = checkedAt + DAY_MS;
      await announce({ state: verdict.state, latest: verdict.latest });
    } catch {
      // Offline, a bad answer or a refused address: keep what was known and try again later.
    }
  }

  /** Checks when a check is due: once a day, an hour after a failure. Safe to call often (the server calls it on its ticker). A check that was off starts at once when turned on. */
  async function tick(force = false): Promise<void> {
    if (await isOff()) {
      last = undefined;
      checkedAt = undefined;
      nextAt = undefined;
      if (!offHandled) {
        offHandled = true;
        await announce(null);
      }
      return;
    }
    offHandled = false;
    if (!force && nextAt !== undefined && now() < nextAt) return;
    // One check at a time, even when a person opens the page while the ticker is in the middle of one.
    running ??= run().finally(() => {
      running = undefined;
    });
    await running;
  }

  return {
    tick,
    /** What is known now. No network, except in a `lazy` process whose last check is a day old. */
    async status(): Promise<UpdateStatus> {
      if (deps.lazy) await tick();
      const check = (await isOff()) ? "off" : "on";
      const known = check === "on" ? last : undefined;
      return {
        build: deps.build,
        state: known?.state ?? "unknown",
        latest: known?.latest ?? null,
        changes: known?.changes ?? [],
        checkedAt:
          check === "on" && checkedAt !== undefined ? new Date(checkedAt).toISOString() : null,
        check,
      };
    },
  };
}
export type UpdateChecker = ReturnType<typeof createUpdateChecker>;
