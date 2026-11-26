import type { Runner } from "./types";

/**
 * The host runner starts a script as the server's own OS user, in no container. Code access being off turns it off, and once Zetta is
 * open to the network it also needs the setting `hostRunner` saved on (settings/code-access.ts). The gate is `hostCode` of
 * `pickRunner`, built in services.ts from that policy.
 */

export type Picked = { runner: Runner } | { refused: "host_off" | "not_set_up" };

/** The runner to use for `name`, or why there is none. `hostCode` is asked on every call, so a change of the switch needs no rebuild. */
export function pickRunner(
  runners: Partial<Record<"host" | "container", Runner>>,
  name: "host" | "container",
  hostCode: () => boolean,
): Picked {
  if (name === "host" && !hostCode()) return { refused: "host_off" };
  const runner = runners[name];
  return runner ? { runner } : { refused: "not_set_up" };
}

/** What the person reads when a run is refused. */
export const refusal = (why: "host_off" | "not_set_up", name: string) =>
  why === "host_off"
    ? "Running code on the server itself is turned off on this installation. Choose the container runner, or ask the administrator."
    : `The ${name} runner is not set up on this server.`;
