import { describe, expect, test } from "bun:test";

import { createChatRoutes } from "./routes";

const conv = "019a0000-0000-7000-8000-000000000001";
const app = (stepOutput: (conversationId: string, stepId: string) => unknown) =>
  createChatRoutes(
    {
      access: { requireActive: async () => ({ userId: "u1" }) },
      chat: { stepOutput: async (_a: unknown, c: string, s: string) => stepOutput(c, s) },
      files: {},
    } as never,
    [],
  );
const get = (routes: ReturnType<typeof app>, stepId: string) =>
  routes.handle(new Request(`http://localhost/api/conversations/${conv}/steps/${stepId}/output`));

async function* pieces(...texts: string[]) {
  for (const t of texts) yield t;
}

describe("GET /conversations/:id/steps/:stepId/output", () => {
  test("streams each piece as a chunk frame and ends with an end frame", async () => {
    const res = await get(
      app(() => pieces("one\n", "two\n")),
      "toolu_1",
    );
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/event-stream");
    expect(res.headers.get("cache-control")).toBe("no-store");
    const frames = (await res.text())
      .split("\n\n")
      .filter((f) => f.startsWith("id:"))
      .map((f) => JSON.parse(f.split("data: ")[1]!));
    expect(frames).toEqual([
      { type: "chunk", text: "one\n" },
      { type: "chunk", text: "two\n" },
      { type: "end" },
    ]);
  });

  test("a step that is unknown, over, or not the caller's is a 404 and nothing streams", async () => {
    const seen: string[] = [];
    const res = await get(
      app((c, s) => {
        seen.push(`${c}/${s}`);
        return undefined;
      }),
      "toolu_gone",
    );
    expect(res.status).toBe(404);
    expect(res.headers.get("content-type")).not.toBe("text/event-stream");
    expect(seen).toEqual([`${conv}/toolu_gone`]);
  });

  test("a conversation id that is not a uuid is refused before the service is asked", async () => {
    let asked = false;
    const routes = app(() => {
      asked = true;
      return undefined;
    });
    const res = await routes.handle(
      new Request("http://localhost/api/conversations/nope/steps/toolu_1/output"),
    );
    expect(res.status).toBe(400);
    expect(asked).toBe(false);
  });
});
