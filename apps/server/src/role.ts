/**
 * What this process does. `all` is the single process of today. With several servers behind a load balancer, `api` instances serve
 * reads, events and auth, and one `worker` runs everything that owns running work: turns, schedulers, recovery, harness containers,
 * browsers and VMs (see docs/operations/scaling.md).
 */
export type Role = "all" | "api" | "worker";

export function parseRole(value: string | undefined): Role {
  const role = value?.trim() || "all";
  if (role === "all" || role === "api" || role === "worker") return role;
  throw new Error(`ZETTA_ROLE must be all, api or worker (got "${role}").`);
}

export const ROLE = parseRole(process.env.ZETTA_ROLE);
/** True when this process owns running work. An `api` process never starts turns, tickers, recovery or sweeps. */
export const runsWork = ROLE !== "api";
