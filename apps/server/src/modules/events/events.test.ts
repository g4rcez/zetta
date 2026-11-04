import { describe, expect, test } from "bun:test";

import { createApp } from "../../app";
import { createIdentityAccess } from "../identity/access";
import { createEventBus } from "./bus";

const origin = "https://app.example.invalid";
const wait = (ms: number) => new Promise((r) => setTimeout(r, ms));

describe("event bus", () => {
  test("delivers a topic once per burst, and only to the user it was published for", async () => {
    const bus = createEventBus(10);
    const a: string[] = [];
    const b: string[] = [];
    bus.subscribe("user-a", (t) => a.push(t));
    bus.subscribe("user-b", (t) => b.push(t));
    bus.publish(["user-a"], "rooms", "conversation:1");
    bus.publish(["user-a"], "rooms");
    expect(a).toEqual([]); // not before the writer's transaction can commit
    await wait(30);
    expect(a).toEqual(["rooms", "conversation:1"]);
    expect(b).toEqual([]);
  });

  test("stops after unsubscribe and counts the open listeners", async () => {
    const bus = createEventBus(5);
    const seen: string[] = [];
    const stop = bus.subscribe("user-a", (t) => seen.push(t));
    expect(bus.count("user-a")).toBe(1);
    stop();
    expect(bus.count("user-a")).toBe(0);
    bus.publish(["user-a"], "rooms");
    await wait(20);
    expect(seen).toEqual([]);
  });
});

function app(bus = createEventBus(5)) {
  const auth = {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("cookie");
        return id
          ? {
              user: { id, name: "Fixture", email: "fixture@example.invalid" },
              session: { id: "s" },
            }
          : null;
      },
    },
    handler: () => new Response("auth"),
  };
  const access = createIdentityAccess(auth, async () => ({ isAdmin: false }));
  return {
    bus,
    app: createApp({ auth, events: { access, bus }, webOrigin: origin, desktopOrigins: [] }),
  };
}

describe("GET /api/events", () => {
  test("a signed-in person gets the topics published for them, as server-sent events", async () => {
    const { app: a, bus } = app();
    const res = await a.handle(
      new Request("http://localhost/api/events", { headers: { cookie: "user-a", origin } }),
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    const reader = res.body!.getReader();
    const decoder = new TextDecoder();
    expect(decoder.decode((await reader.read()).value)).toBe(": ok\n\n");
    bus.publish(["user-b"], "attention"); // someone else's topic never arrives
    bus.publish(["user-a"], "conversation:1");
    expect(decoder.decode((await reader.read()).value)).toBe(
      'data: {"topic":"conversation:1"}\n\n',
    );
    await reader.cancel();
    expect(bus.count("user-a")).toBe(0);
  });

  test("a signed-out request is refused before any stream starts", async () => {
    const { app: a } = app();
    const res = await a.handle(new Request("http://localhost/api/events", { headers: { origin } }));
    expect(res.status).toBe(401);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe("SIGN_IN_REQUIRED");
  });

  test("a person with ten streams open cannot open an eleventh", async () => {
    const { app: a, bus } = app();
    const open = () =>
      a.handle(
        new Request("http://localhost/api/events", { headers: { cookie: "user-a", origin } }),
      );
    const streams = await Promise.all(Array.from({ length: 10 }, open));
    expect(streams.every((r) => r.status === 200)).toBe(true);
    const extra = await open();
    expect(extra.status).toBe(429);
    await Promise.all(streams.map((r) => r.body!.cancel()));
    expect(bus.count("user-a")).toBe(0);
  });
});
