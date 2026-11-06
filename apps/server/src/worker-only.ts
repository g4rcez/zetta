import { Elysia } from "elysia";

type Rule = { methods?: readonly string[]; path: RegExp };

/**
 * Requests that need what only the worker process has: harness containers, browser sessions, VMs, the local model, and the process that
 * owns running turns (their stream, cancel and state live in its memory until turns move to a shared log). The load balancer sends
 * them to the worker; an `api` process that still receives one answers 421 so a wrong route fails loudly instead of half working.
 * Keep docker/Caddyfile in step with this list.
 */
export const WORKER_ONLY: readonly Rule[] = [
  { path: /^\/api\/computer(\/|$)/ },
  { path: /^\/api\/harnesses$/ },
  { path: /^\/api\/inbound\// },
  // A webhook starts a run in the worker: the bot turn and its stream live in that process.
  { methods: ["POST"], path: /^\/api\/routines\/hook\/[^/]+$/ },
  { path: /^\/api\/decisions(\/|$)/ },
  // Sealed credentials: the key a browser seals to lives in one process's memory, and so do the single-use OAuth callback guards.
  { path: /^\/api\/plugins\/[^/]+\/(test|connect|disconnect|callback)$/ },
  { methods: ["GET"], path: /^\/api\/connections\/transport-key$/ },
  { methods: ["POST"], path: /^\/api\/(connections|plugins)$/ },
  { methods: ["PUT"], path: /^\/api\/plugins\/[^/]+\/config$/ },
  { path: /^\/api\/bots\/[^/]+\/onboarding(\/|$)/ },
  { methods: ["POST"], path: /^\/api\/(workflows|routines)\/[^/]+\/run$/ },
  { methods: ["POST"], path: /^\/api\/(bots\/interview|(memory|wiki)-assist)$/ },
  { methods: ["POST"], path: /^\/api\/proposals\/[^/]+\/decision$/ },
  // Turns: start, follow, cancel and read state.
  {
    methods: ["POST"],
    path: /^\/api\/conversations\/[^/]+\/(stream|chat|messages|queue|cancel|turn\/wait)$/,
  },
  { methods: ["POST"], path: /^\/api\/conversations\/[^/]+\/queue\/[^/]+\/retry$/ },
  { methods: ["GET"], path: /^\/api\/conversations\/[^/]+\/(stream|chat\/stream|turn)$/ },
];

export const isWorkerOnly = (method: string, path: string) =>
  WORKER_ONLY.some((r) => (!r.methods || r.methods.includes(method)) && r.path.test(path));

/** On an `api` process: refuse worker-only requests. */
export const workerOnlyGuard = () =>
  new Elysia({ name: "worker-only-guard" }).onRequest(({ request }) => {
    if (!isWorkerOnly(request.method, new URL(request.url).pathname)) return;
    return Response.json(
      { error: { code: "WORKER_ROUTE", message: "This request must reach the worker server." } },
      { status: 421, headers: { "cache-control": "no-store" } },
    );
  });
