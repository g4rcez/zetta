import { Elysia } from "elysia";

/**
 * For the load balancer: `healthz` says the process runs, `readyz` that it can serve (the database answers within a second).
 * Neither looks up a session or writes a request log, because a balancer calls them every few seconds.
 */
export const healthRoutes = (ready?: () => Promise<boolean>) =>
  new Elysia({ name: "health" })
    .get("/healthz", () => "OK")
    .get("/readyz", async ({ set }) => {
      const up = ready
        ? await Promise.race([
            ready().catch(() => false),
            new Promise<boolean>((resolve) => setTimeout(() => resolve(false), 1_000)),
          ])
        : true;
      set.status = up ? 200 : 503;
      return up ? "OK" : "NOT READY";
    });
