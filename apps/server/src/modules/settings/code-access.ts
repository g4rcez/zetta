// May bots (and the playground's host runner) run code on this server right now? Two things decide, both asked at every call:
//   1. the setting `codeAccess` (security policy; off turns code off for every bot at once), and
//   2. the install itself: when Zetta is open to the network and bots do not run in Docker, code on the host would run as the server's own
//      OS user, so one member's bot could read another member's files, VM tokens and browser profiles. Then code is off **unless an
//      administrator explicitly saved `codeAccess = on`** (the old `ZETTA_CODE_ACCESS=host`, which the import turns into a saved `on`): the
//      registry default `on` does not count, so an install that never chose stays safe.
// The old code wrote the variable ZETTA_CODE_ACCESS at start for the second case; nothing writes or reads that variable any more.
import type { SettingsService } from "./service";

export type CodeAccessInputs = {
  settings: Pick<SettingsService, "peek" | "peekStored">;
  /** The mode the server runs in (`installation_settings.network_mode` as it started: a change needs a restart anyway). */
  networkMode: () => "local" | "network";
  /** The runtime of bot harnesses (`ZETTA_HARNESS_RUNTIME`, a host variable): `docker` keeps the CLI out of the host. */
  harnessRuntime: () => string | undefined;
};

/** The reason code is off, or null when it is on. */
export type CodeAccessVerdict = "setting_off" | "open_network_without_docker" | "unknown" | null;

export function createCodeAccess({ settings, networkMode, harnessRuntime }: CodeAccessInputs) {
  /** Synchronous because its callers are (`codeEnabled`, the playground's host gate): the setting comes from `SettingsService.peek`. */
  const verdict = (): CodeAccessVerdict => {
    if (networkMode() === "network" && harnessRuntime() !== "docker") {
      const saved = settings.peekStored("codeAccess");
      if (saved === undefined) return "unknown";
      // Only an explicit, saved "on" accepts the risk; the default (never chosen) and "off" keep code off.
      if (!(saved.stored && saved.value === "on")) return "open_network_without_docker";
    }
    const value = settings.peek("codeAccess");
    // Fail closed: a value that was never read, or that the database has not confirmed for a while, is not "on".
    if (value === undefined) return "unknown";
    return value === "on" ? null : "setting_off";
  };
  return { verdict, allowed: () => verdict() === null };
}
export type CodeAccess = ReturnType<typeof createCodeAccess>;
