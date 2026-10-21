import { cors } from "@elysiajs/cors";
import { Elysia } from "elysia";
import { initLogger } from "evlog";
import { createAxiomDrain } from "evlog/axiom";
import { createAuthMiddleware, type BetterAuthInstance } from "evlog/better-auth";
import { evlog } from "evlog/elysia";

import { desktopOrigins, ENV } from "./env.server";
import { auth } from "./services";

initLogger({
  env: { service: "zetta-server" },
});

const identifyUser = createAuthMiddleware(auth as BetterAuthInstance, {
  exclude: ["/api/auth/**"],
  maskEmail: true,
});

new Elysia()
  .use(evlog({ drain: createAxiomDrain() }))
  .derive(async ({ request, log }) => {
    await identifyUser(log, request.headers, new URL(request.url).pathname);
    return {};
  })
  .use(
    cors({
      origin: [ENV.CORS_ORIGIN, ...desktopOrigins],
      methods: ["GET", "POST", "OPTIONS"],
      allowedHeaders: ["Content-Type", "Authorization"],
      credentials: true,
    }),
  )
  .all("/api/auth/*", async (context) => {
    const { request, status } = context;
    if (["POST", "GET"].includes(request.method)) {
      return auth.handler(request);
    }
    return status(405);
  })
  .get("/", () => "OK")
  .listen(3000, () => {
    console.log("Server is running on http://localhost:3000");
  });
