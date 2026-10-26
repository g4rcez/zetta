import { describe, expect, test, spyOn } from "bun:test";
import { createApp } from "./app";
import { createIdentityAccess } from "./modules/identity/access";
import type { DrainContext } from "evlog";

import { createAppFixture, fixtureOrigins, fixtureSessions } from "./test-support/fixtures";

describe("createApp", () => {
  test("imports in a secret-free process without bootstrap, network or timers", async () => {
    const appUrl = new URL("./app.ts", import.meta.url).href;
    const script = `
      import { Elysia } from ${JSON.stringify(import.meta.resolve("elysia"))};
      import { getEnvironment } from ${JSON.stringify(import.meta.resolve("evlog"))};
      const before = JSON.stringify(getEnvironment());
      const forbidden = () => { throw new Error("Import attempted a bootstrap side effect"); };
      Bun.serve = forbidden;
      Bun.connect = forbidden;
      globalThis.fetch = forbidden;
      globalThis.setTimeout = forbidden;
      globalThis.setInterval = forbidden;
      Elysia.prototype.listen = forbidden;
      const { createApp } = await import(${JSON.stringify(appUrl)});
      if (typeof createApp !== "function") throw new Error("Missing createApp");
      if (JSON.stringify(getEnvironment()) !== before) throw new Error("Logger initialized on import");
      console.log("isolated import OK");
    `;
    const child = Bun.spawn([process.execPath, "--eval", script], {
      cwd: new URL("../../..", import.meta.url).pathname,
      env: { NODE_ENV: "test" },
      stdout: "pipe",
      stderr: "pipe",
    });
    const [exitCode, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ]);
    expect({ exitCode, stdout, stderr }).toEqual({
      exitCode: 0,
      stdout: "isolated import OK\n",
      stderr: "",
    });

    // Keep the import graph closed: production environment/services/Axiom and
    // bootstrap calls belong only in index.ts, never in the testable factory.
    const source = await Bun.file(new URL("./app.ts", import.meta.url)).text();
    const allowedImports = ["@elysiajs/cors", "elysia", "evlog/better-auth", "evlog/elysia", "./modules/identity/routes", "./modules/chat/routes", "./modules/features/routes", "./modules/decisions/routes", "./modules/computer/routes", "./modules/connections/routes", "./modules/integrations/routes", "./modules/agenda/routes", "./modules/discussions/routes", "./modules/inbound/routes", "./modules/bot-database/routes"];
    const imports = [...source.matchAll(/from\s+["']([^"']+)["']/g)].map((match) => match[1] ?? "");
    expect(imports.length).toBeGreaterThan(0);
    for (const imported of imports) expect(allowedImports).toContain(imported);
    expect(source).not.toMatch(/initLogger|createAxiomDrain|\.listen\s*\(|import\s*\(/);
  });

  test("returns the existing anonymous health response and records an in-memory event", async () => {
    const fixture = createAppFixture();
    const response = await fixture.app.handle(new Request("http://localhost/"));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(fixture.app.server).toBeNull();
    expect(fixture.sessionLookups).toHaveLength(1);
    expect(fixture.authRequests).toHaveLength(0);
    const { event } = await fixture.nextEvent();
    expect(event).toMatchObject({ service: "zetta-server", method: "GET", path: "/", status: 200, auth: { identified: false } });
    expect(event.userId).toBeUndefined();
    expect(event.user).toBeUndefined();
  });

  for (const { method, body, contentType, status } of [
    { method: "GET", body: undefined, contentType: "text/plain", status: 401 },
    { method: "POST", body: "synthetic-auth-body", contentType: "text/plain", status: 202 },
    { method: "POST", body: '{"fixture":"only"}', contentType: "application/json", status: 200 },
  ]) {
    test(`forwards the original auth ${method} ${contentType} request and preserves its ${status} response`, async () => {
      const request = new Request("http://localhost/api/auth/session?fixture=only", {
        method,
        headers: { "content-type": contentType, "x-fixture": "forwarded", cookie: "fixture-session=A" },
        body,
      });
      const fixture = createAppFixture(async (forwarded) => {
        expect(forwarded).toBe(request);
        expect(forwarded.url).toBe(request.url);
        expect(forwarded.method).toBe(method);
        expect(forwarded.headers.get("x-fixture")).toBe("forwarded");
        expect(forwarded.headers.get("cookie")).toBe("fixture-session=A");
        expect(await forwarded.text()).toBe(body ?? "");
        return new Response("synthetic auth response", {
          status,
          headers: { "x-fixture-response": "preserved", "set-cookie": "fixture=only; HttpOnly" },
        });
      });
      const response = await fixture.app.handle(request);
      expect(response.status).toBe(status);
      expect(response.headers.get("x-fixture-response")).toBe("preserved");
      expect(response.headers.get("set-cookie")).toBe("fixture=only; HttpOnly");
      expect(await response.text()).toBe("synthetic auth response");
      expect(fixture.authRequests).toEqual([request]);
      expect(fixture.sessionLookups).toHaveLength(0);
      const { event } = await fixture.nextEvent();
      expect(event.status).toBe(status);
      expect(event.auth).toBeUndefined();
      expect(event.userId).toBeUndefined();
    });
  }

  for (const method of ["PUT", "PATCH", "DELETE", "HEAD"]) {
    test(`returns 405 for unsupported auth ${method} without forwarding or session lookup`, async () => {
      const fixture = createAppFixture();
      const response = await fixture.app.handle(new Request("http://localhost/api/auth/session", { method }));
      expect(response.status).toBe(405);
      expect(fixture.authRequests).toHaveLength(0);
      expect(fixture.sessionLookups).toHaveLength(0);
      await fixture.nextEvent();
    });
  }

  for (const origin of [fixtureOrigins.webOrigin, ...fixtureOrigins.desktopOrigins]) {
    test(`allows credentialed CORS for ${origin}`, async () => {
      const fixture = createAppFixture();
      const response = await fixture.app.handle(new Request("http://localhost/", { headers: { origin } }));
      expect(response.status).toBe(200);
      expect(response.headers.get("access-control-allow-origin")).toBe(origin);
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
      expect(response.headers.get("vary")).toBe("Origin");
      await fixture.nextEvent();
    });
  }

  test("does not approve an unlisted CORS origin (CORS is not an authorization rejection)", async () => {
    const fixture = createAppFixture();
    const response = await fixture.app.handle(new Request("http://localhost/", { headers: { origin: "https://unapproved.invalid" } }));
    expect(response.status).toBe(200);
    expect(await response.text()).toBe("OK");
    expect(response.headers.get("access-control-allow-origin")).toBeNull();
    // The installed plugin still emits credentials=true; without allow-origin
    // this does not authorize a browser to read the response.
    expect(response.headers.get("access-control-allow-credentials")).toBe("true");
    await fixture.nextEvent();
  });

  for (const origin of [fixtureOrigins.webOrigin, ...fixtureOrigins.desktopOrigins, "https://unapproved.invalid"]) {
    test(`handles auth OPTIONS preflight for ${origin} before the 405 route`, async () => {
      const fixture = createAppFixture();
      const response = await fixture.app.handle(new Request("http://localhost/api/auth/sign-in/email", {
        method: "OPTIONS",
        headers: { origin, "access-control-request-method": "POST", "access-control-request-headers": "content-type,authorization" },
      }));
      expect(response.status).toBe(204);
      expect(await response.text()).toBe("");
      expect(response.headers.get("access-control-allow-origin")).toBe(origin === "https://unapproved.invalid" ? null : origin);
      expect(response.headers.get("access-control-allow-credentials")).toBe("true");
      expect(response.headers.get("access-control-allow-methods")).toBe("GET, POST, PUT, PATCH, DELETE, OPTIONS");
      expect(response.headers.get("access-control-allow-headers")).toBe("Content-Type, Authorization");
      expect(fixture.authRequests).toHaveLength(0);
      expect(fixture.sessionLookups).toHaveLength(0);
      // CORS short-circuits in onRequest; Elysia 1.4 does not run the evlog
      // after-response hook on this path, so no drain event is expected.
      expect(fixture.events).toHaveLength(0);
    });
  }

  test("keeps A/B session identities separate and masks emails with the real logging middleware", async () => {
    const fixture = createAppFixture();
    for (const actor of ["A", "B", null] as const) {
      const request = new Request("http://localhost/", {
        headers: actor ? { cookie: `fixture-session=${actor}` } : {},
      });
      expect((await fixture.app.handle(request)).status).toBe(200);
      expect(fixture.sessionLookups.at(-1)).toBe(request.headers);
      const { event } = await fixture.nextEvent();
      if (actor) {
        const session = fixtureSessions[actor];
        expect(event).toMatchObject({
          userId: session.user.id,
          user: { id: session.user.id, name: session.user.name, email: `${session.user.email[0]}***@example.invalid` },
          session: { id: session.session.id },
          auth: { identified: true },
        });
      } else {
        expect(event.userId).toBeUndefined();
        expect(event.session).toBeUndefined();
        expect(event.auth).toMatchObject({ identified: false });
      }
    }
    expect(fixture.sessionLookups).toHaveLength(3);
    expect(fixture.events).toHaveLength(3);
    const serialized = JSON.stringify(fixture.events);
    for (const session of Object.values(fixtureSessions)) {
      expect(serialized).not.toContain(session.user.email);
      expect(serialized).not.toContain(session.session.token);
    }
    expect(serialized).not.toContain("fixture-session=");
  });
});

test("private session failures remain opaque while actual identity access returns 503", async () => {
  createAppFixture();
  const warnings = spyOn(console, "warn").mockImplementation(() => {});
  const drained = Promise.withResolvers<DrainContext>();
  const auth = { api: { getSession: async () => { throw new Error("synthetic-private-driver-detail"); } }, handler: () => new Response("auth") };
  const app = createApp({ auth, ...fixtureOrigins, drain: (event) => { drained.resolve(event); }, identity: {
    access: createIdentityAccess(auth, async () => { throw new Error("Membership must not resolve"); }),
    enrollment: {
      issueInvitation: async () => { throw new Error("unused"); },
      acceptInvitation: async () => { throw new Error("unused"); },
      revokeInvitation: async () => { throw new Error("unused"); },
    },
  } });
  try {
    const response = await app.handle(new Request("http://localhost/api/identity/status"));
    expect(response.status).toBe(503);
    expect(await response.text()).not.toContain("synthetic-private-driver-detail");
    expect(warnings.mock.calls).toHaveLength(0);
    expect((await drained.promise).event.status).toBe(503);
  } finally { warnings.mockRestore(); }
});
