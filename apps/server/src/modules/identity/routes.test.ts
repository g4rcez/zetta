import { describe, expect, test } from "bun:test";
import { createIdentityAccess } from "./access";
import { createIdentityRoutes } from "./routes";
import { createApp } from "../../app";
import type { DrainContext } from "evlog";

const origins = ["https://app.example.invalid", "tauri://localhost"] as const;
const token = "A".repeat(43);
function fixture() {
  const calls: unknown[] = [];
  const events: DrainContext[] = [];
  const waiters: Array<() => void> = [];
  const waitForEvents = (count: number) => events.length >= count ? Promise.resolve() : new Promise<void>((resolve) => waiters.push(() => { if (events.length >= count) resolve(); }));
  const members = new Set(["A", "admin"]);
  const auth = { api: { getSession: async ({ headers }: { headers: Headers }) => {
    const id = headers.get("cookie");
    return id ? { user: { id, name: "Fixture", email: "fixture@example.invalid" }, session: { id: "fixture-session" } } : null;
  } }, handler: () => new Response("auth") };
  const identity = {
    access: createIdentityAccess(auth, async (id) => members.has(id) ? { isAdmin: id === "admin" } : null),
    enrollment: {
      issueInvitation: async (actor: unknown, body: unknown) => { calls.push({ actor, body }); return { invitationId: "invite", token, expiresAt: new Date("2030-01-01") }; },
      acceptInvitation: async (actor: { userId: string }, body: unknown) => { calls.push({ actor, body }); if (members.has(actor.userId)) throw Error(`private ${token}`); members.add(actor.userId); return { userId: actor.userId }; },
      revokeInvitation: async (actor: unknown, body: unknown) => { calls.push({ actor, body }); return { invitationId: "invite" }; },
    },
  };
  const app = createApp({ auth, identity, webOrigin: origins[0], desktopOrigins: [origins[1]], drain: (event) => { events.push(event); for (const waiter of waiters) waiter(); } });
  const request = (path: string, user?: string, body?: unknown, headers: Record<string, string> = {}) => app.handle(new Request(`http://localhost/api/identity/${path}`, {
    method: body === undefined ? "GET" : "POST",
    headers: { ...(user ? { cookie: user } : {}), ...(body !== undefined ? { origin: origins[0], "content-type": "application/json" } : {}), ...headers },
    body: body === undefined ? undefined : JSON.stringify(body),
  }));
  return { app, identity, request, calls, events, members, waitForEvents };
}

describe("identity HTTP contract with synthetic sessions", () => {
  test("own status only, removal denies active authority and acceptance can re-enroll", async () => {
    const f = fixture();
    for (const [user, expected] of [[undefined, { state: "anonymous" }], ["B", { state: "unenrolled", userId: "B" }], ["A", { state: "active", userId: "A", isAdmin: false }], ["admin", { state: "active", userId: "admin", isAdmin: true }]] as const) {
      const response = await f.request("status?userId=admin", user);
      expect(response.status).toBe(200);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.json()).toEqual(expected);
    }
    f.members.delete("A");
    expect((await f.request("invitations", "A", { intendedEmail: "b@example.invalid" })).status).toBe(403);
    const accepted = await f.request("invitations/accept", "A", { token });
    expect(accepted.status).toBe(200);
    expect(await accepted.json()).toEqual({ userId: "A" });
    expect((await f.request("invitations/accept", "A", { token })).status).toBe(409);
  });

  test("admin issuance/revocation, exact fields, no body-derived actor, no token logs", async () => {
    const f = fixture();
    expect((await f.request("invitations", undefined, { intendedEmail: "b@example.invalid" })).status).toBe(401);
    expect((await f.request("invitations", "A", { intendedEmail: "b@example.invalid" })).status).toBe(403);
    expect((await f.request("invitations", "admin", { intendedEmail: "b@example.invalid", ownerUserId: "B" })).status).toBe(400);
    expect(f.calls).toHaveLength(0);
    const issued = await f.request("invitations", "admin", { intendedEmail: "b@example.invalid", intendedUserId: "B" });
    expect(issued.status).toBe(201);
    expect(issued.headers.get("cache-control")).toBe("no-store");
    expect(await issued.json()).toEqual({ invitationId: "invite", token, expiresAt: "2030-01-01T00:00:00.000Z" });
    expect(f.calls[0]).toEqual({ actor: { userId: "admin" }, body: { intendedEmail: "b@example.invalid", intendedUserId: "B" } });
    expect((await f.request("invitations/revoke", "admin", { invitationId: "invite" })).status).toBe(200);
    const failed = await f.request("invitations/accept", "A", { token });
    expect(failed.status).toBe(409);
    expect(await failed.text()).not.toContain(token);
    await f.waitForEvents(6);
    expect(f.events.map(({ event }) => event.status)).toEqual([401, 403, 400, 201, 200, 409]);
    expect(f.events.length).toBeGreaterThan(0);
    expect(JSON.stringify(f.events)).not.toContain(token);
    expect(JSON.stringify(f.events)).not.toContain("b@example.invalid");
  });

  test("trusted origins only and metadata/content/query/body failures precede enrollment", async () => {
    const rejectedHeaders: Record<string, string>[] = [{ origin: "" }, { origin: "null" }, { origin: "https://evil.invalid" }, { "sec-fetch-mode": "navigate" }, { "sec-fetch-mode": "no-cors" }, { "sec-fetch-site": "invalid" }];
    for (const headers of rejectedHeaders) {
      const f = fixture();
      expect((await f.request("invitations/accept", "B", { token }, headers)).status).toBe(403);
      expect(f.calls).toHaveLength(0);
    }
    for (const origin of origins) {
      const f = fixture();
      expect((await f.request("invitations/accept", "B", { token }, { origin, "sec-fetch-mode": "cors", "sec-fetch-site": "cross-site" })).status).toBe(200);
    }
    const f = fixture();
    for (const body of [{ token, userId: "admin" }, { token: "bad" }, { token: 1 }, {}, null]) {
      const response = await f.request("invitations/accept", "B", body);
      expect(response.status).toBe(400);
      expect(response.headers.get("cache-control")).toBe("no-store");
      expect(await response.text()).not.toContain(token);
    }
    expect((await f.request("invitations/accept?token=bad", "B", { token })).status).toBe(400);
    expect(f.calls).toHaveLength(0);
  });

  test("parser failures never echo token through response or evlog", async () => {
    const f = fixture();
    const response = await f.app.handle(new Request("http://localhost/api/identity/invitations/accept", { method: "POST", headers: { origin: origins[0], "content-type": "application/json" }, body: `{"token":"${token}` }));
    expect(response.status).toBe(400);
    expect(await response.text()).not.toContain(token);
    await f.waitForEvents(1);
    expect(f.events[0]?.event.status).toBe(400);
    expect(JSON.stringify(f.events)).not.toContain(token);
  });

  test("actual loopback HTTP listener preserves fixture contract", async () => {
    const f = fixture();
    const app = createIdentityRoutes(f.identity, origins).listen({ hostname: "127.0.0.1", port: 0 });
    try {
      if (!app.server) throw Error("Fixture listener unavailable");
      const response = await fetch(`${app.server.url}api/identity/status`, { headers: { cookie: "admin" } });
      expect(response.status).toBe(200);
      expect(await response.json()).toEqual({ state: "active", userId: "admin", isAdmin: true });
      const post = (path: string, user: string, body: unknown, origin = origins[0]) => fetch(`${app.server?.url}api/identity/${path}`, {
        method: "POST", headers: { cookie: user, origin, "content-type": "application/json" }, body: JSON.stringify(body),
      });
      const issued = await post("invitations", "admin", { intendedEmail: "b@example.invalid" });
      expect(issued.status).toBe(201);
      expect(issued.headers.get("cache-control")).toBe("no-store");
      expect((await post("invitations/accept", "B", { token })).status).toBe(200);
      expect((await post("invitations/accept", "B", { token })).status).toBe(409);
      expect((await post("invitations", "B", { intendedEmail: "b@example.invalid" })).status).toBe(403);
      expect((await post("invitations/revoke", "admin", { invitationId: "invite" })).status).toBe(200);
      console.info("HTTP fixture: own status 200; admin issue 201/no-store; B accept 200; replay 409; nonadmin issue 403; revoke 200; synthetic services only");
    } finally { await app.stop(); }
  });
});
