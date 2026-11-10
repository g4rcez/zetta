/**
 * Where a bot's computer and browser may run. The rule (owner decision, 2026-11-10):
 *   - A server open to the network ("network" install) never lets a bot drive the server itself: the browser runs only in its hardened
 *     container, the desktop only in a VM (container) or on a remote computer the person added.
 *   - A local install (Zetta on the person's own machine) may also use that machine: its desktop and the person's own browser.
 * Pure: the services ask it before they start anything.
 */
export type InstallMode = "local" | "network";
export type BrowserRuntime = "host" | "docker";

export type Placement = { ok: true } | { ok: false; reason: string };

export function browserPlacement(install: InstallMode, runtime: BrowserRuntime): Placement {
  if (install === "network" && runtime === "host")
    return {
      ok: false,
      reason:
        "This Zetta server is open to the network, so a bot's browser must run in its container, and the container runtime is not set up (ZETTA_BROWSER_RUNTIME=docker).",
    };
  return { ok: true };
}

/** The computer targets a person may add here. "local" is this machine's own desktop. */
export function desktopTargets(
  install: InstallMode,
  o: { vm: boolean; remote: boolean; host: boolean },
): ("vm" | "cua" | "local")[] {
  return [
    ...(o.vm ? (["vm"] as const) : []),
    ...(o.remote ? (["cua"] as const) : []),
    ...(install === "local" && o.host ? (["local"] as const) : []),
  ];
}
