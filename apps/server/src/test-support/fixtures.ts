import { initLogger, type DrainContext } from "evlog";

import { createApp, type AppAuth } from "../app";

export const fixtureOrigins = {
  webOrigin: "http://web.invalid:3001",
  desktopOrigins: ["views://mainview"],
};

export const fixtureSessions = {
  A: {
    user: { id: "user-a", name: "Synthetic A", email: "alice@example.invalid" },
    session: { id: "session-a", token: "synthetic-private-a" },
  },
  B: {
    user: { id: "user-b", name: "Synthetic B", email: "bob@example.invalid" },
    session: { id: "session-b", token: "synthetic-private-b" },
  },
};

export function createAppFixture(
  handler: AppAuth["handler"] = () => new Response("fixture auth"),
) {
  const events: DrainContext[] = [];
  const pendingEvents: DrainContext[] = [];
  const waiters: ((event: DrainContext) => void)[] = [];
  const drain = (context: DrainContext) => {
    events.push(context);
    const waiter = waiters.shift();
    if (waiter) waiter(context);
    else pendingEvents.push(context);
  };

  // evlog merges global plugins and falls back to a global drain. Clear both,
  // silence console output, and keep real request logging entirely in memory.
  initLogger({
    enabled: true,
    env: { service: "zetta-server", environment: "test" },
    silent: true,
    redact: false,
    plugins: [],
    drain,
  });

  const sessionLookups: Headers[] = [];
  const authRequests: Request[] = [];
  const auth: AppAuth = {
    api: {
      async getSession({ headers }) {
        sessionLookups.push(headers);
        switch (headers.get("cookie")) {
          case "fixture-session=A":
            return fixtureSessions.A;
          case "fixture-session=B":
            return fixtureSessions.B;
          default:
            return null;
        }
      },
    },
    handler(request) {
      authRequests.push(request);
      return handler(request);
    },
  };

  return {
    app: createApp({ auth, ...fixtureOrigins, drain }),
    events,
    sessionLookups,
    authRequests,
    nextEvent(): Promise<DrainContext> {
      const event = pendingEvents.shift();
      return event
        ? Promise.resolve(event)
        : new Promise((resolve) => waiters.push(resolve));
    },
  };
}
