import { describe, expect, test } from "bun:test";

import { DiscussionError } from "./store";
import { createDiscussionRoutes } from "./routes";

const ORIGIN = "http://web.test";
const roomId = "019a0000-0000-7000-8000-0000000000aa";
const conversationId = "019a0000-0000-7000-8000-0000000000bb";
const room = { id: roomId, conversationId, status: "cancelled" };

/** Routes over a fake store that records calls in order, so a test can see that the status change comes before the abort. */
const build = (over: Record<string, unknown> = {}) => {
  const calls: string[] = [];
  const routes = createDiscussionRoutes(
    {
      access: { requireActive: async () => ({ userId: "u1" }) },
      store: {
        setStatus: async (_a: unknown, id: string, action: string) => {
          calls.push(`setStatus:${id}:${action}`);
          return room;
        },
        remove: async (_a: unknown, id: string) => {
          calls.push(`remove:${id}`);
          return { discussion: room, transcript: [] };
        },
        silence: async (_a: unknown, id: string) => {
          calls.push(`silence:${id}`);
          return room;
        },
        ...over,
      },
      worker: {},
      chat: {
        cancelTurn: async (_a: unknown, c: string) => {
          calls.push(`cancelTurn:${c}`);
          return true;
        },
      },
    } as never,
    [ORIGIN],
  );
  const post = (path: string) =>
    routes.handle(
      new Request(`http://localhost/api/discussions/${roomId}/${path}`, {
        method: "POST",
        headers: { origin: ORIGIN, "content-type": "application/json" },
        body: "{}",
      }),
    );
  return { calls, post };
};

describe("room routes that end or silence a room", () => {
  test("cancel marks the room, then stops its running turns", async () => {
    const { calls, post } = build();
    const res = await post("cancel");
    expect(res.status).toBe(200);
    expect(calls).toEqual([`setStatus:${roomId}:cancel`, `cancelTurn:${conversationId}`]);
    const body = (await res.json()) as { discussion: { status: string } };
    expect(body.discussion.status).toBe("cancelled");
  });

  test("delete removes the room, then stops its running turns", async () => {
    const { calls, post } = build();
    const res = await post("delete");
    expect(res.status).toBe(200);
    expect(calls).toEqual([`remove:${roomId}`, `cancelTurn:${conversationId}`]);
  });

  test("pause does not stop the running turn", async () => {
    const { calls, post } = build();
    const res = await post("pause");
    expect(res.status).toBe(200);
    expect(calls).toEqual([`setStatus:${roomId}:pause`]);
  });

  test("a refused cancel stops nothing", async () => {
    const { calls, post } = build({
      setStatus: async () => {
        throw new DiscussionError("CLOSED", "This room is cancelled.");
      },
    });
    const res = await post("cancel");
    expect(res.status).toBe(409);
    expect(calls.some((call) => call.startsWith("cancelTurn"))).toBe(false);
  });

  test("silence still stops the running turns", async () => {
    const { calls, post } = build();
    const res = await post("silence");
    expect(res.status).toBe(200);
    expect(calls).toEqual([`silence:${roomId}`, `cancelTurn:${conversationId}`]);
  });
});
