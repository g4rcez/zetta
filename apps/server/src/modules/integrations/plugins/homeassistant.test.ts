import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDecisionService } from "../../decisions/service";
import { configureHomeAssistant } from "./homeassistant";
import { homeFastPath } from "./homeassistant-fast";
import { actor, world } from "./test-world";

/** A fake Home Assistant on loopback: the real external boundary of the plugin. */
type Seen = { method: string; path: string; auth: string | null; body: unknown };
let seen: Seen[] = [];
let assistAnswer: unknown = {};
const STATES = [
  { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen light" } },
  { entity_id: "light.hall", state: "off", attributes: { friendly_name: "Hall light" } },
  { entity_id: "sensor.temp", state: "21", attributes: {} },
];
const server = Bun.serve({
  port: 0,
  async fetch(req) {
    const url = new URL(req.url);
    const auth = req.headers.get("authorization");
    const body = req.method === "POST" ? await req.json().catch(() => undefined) : undefined;
    seen.push({ method: req.method, path: url.pathname, auth, body });
    if (auth !== "Bearer good-token") return new Response("no", { status: 401 });
    if (url.pathname === "/api/") return Response.json({ message: "API running." });
    if (url.pathname === "/api/states") return Response.json(STATES);
    if (url.pathname === "/api/services/light/turn_off")
      return Response.json([{ entity_id: "light.kitchen", state: "off", attributes: {} }]);
    if (url.pathname === "/api/conversation/process") return Response.json(assistAnswer);
    return new Response("nope", { status: 404 });
  },
});
const baseUrl = `http://127.0.0.1:${server.port}`;
const done = {
  response: { response_type: "action_done", speech: { plain: { speech: "Turned off the light" } } },
};
const noMatch = {
  response: {
    response_type: "error",
    speech: { plain: { speech: "Sorry, I am not aware of any device called that" } },
    data: { code: "no_intent_match" },
  },
};

/** A stub Laya model that answers every question with a literal choice. */
const laya = async (choice: "home_control" | "other", p: number) => {
  let calls = 0;
  const svc = createDecisionService(
    async () =>
      ({
        systemOne: async () => {
          calls++;
          return {
            answers: {
              pick: {
                choice,
                probabilities: {
                  [choice]: p,
                  ...(choice === "other" ? { home_control: 1 - p } : { other: 1 - p }),
                },
              },
            },
          };
        },
        close: async () => {},
      }) as never,
    1000,
    { mode: "on" },
  );
  await svc.warm();
  return { svc, calls: () => calls };
};

const setup = async (fields: Record<string, string> = {}) => {
  const w = world();
  const a = actor("u1");
  await w.plugins.install(a, "homeassistant", { baseUrl, token: "good-token", ...fields });
  await w.plugins.setBinding(a, "bot1", "homeassistant", true);
  return { ...w, a };
};

beforeAll(() => configureHomeAssistant({ allowPrivate: true }));
afterAll(() => server.stop(true));
beforeEach(() => {
  seen = [];
  assistAnswer = done;
});

describe("homeassistant plugin", () => {
  test("a rejected token fails the install and keeps nothing", async () => {
    const { plugins, secrets } = world();
    const a = actor("u1");
    await expect(
      plugins.install(a, "homeassistant", { baseUrl, token: "wrong" }),
    ).rejects.toMatchObject({ code: "NEEDS_AUTH" });
    expect(await plugins.list(a)).toEqual([]);
    expect([...secrets.values()].filter((s) => !s.revoked)).toHaveLength(0);
  });

  test("states lists compact rows and filters by domain", async () => {
    const { plugins, a } = await setup();
    const out = JSON.parse(
      await plugins.callTool(a, "bot1", "homeassistant", "states", { domain: "light" }),
    );
    expect(out).toEqual({
      total: 2,
      states: [
        { entity_id: "light.kitchen", name: "Kitchen light", state: "on" },
        { entity_id: "light.hall", name: "Hall light", state: "off" },
      ],
    });
  });

  test("call_service posts the service with the entity id", async () => {
    const { plugins, a } = await setup();
    const out = JSON.parse(
      await plugins.callTool(a, "bot1", "homeassistant", "call_service", {
        domain: "light",
        service: "turn_off",
        entity_id: "light.kitchen",
      }),
    );
    expect(out).toEqual({ changed: [{ entity_id: "light.kitchen", state: "off" }] });
    const call = seen.find((s) => s.path === "/api/services/light/turn_off");
    expect(call?.body).toEqual({ entity_id: "light.kitchen" });
    expect(call?.auth).toBe("Bearer good-token");
  });

  test("call_service rejects a path-like domain without any request", async () => {
    const { plugins, a } = await setup();
    seen = [];
    await expect(
      plugins.callTool(a, "bot1", "homeassistant", "call_service", {
        domain: "../x",
        service: "turn_off",
      }),
    ).rejects.toMatchObject({ code: "INVALID_ARGS" });
    expect(seen).toEqual([]);
  });
});

describe("home fast path", () => {
  const run = async (
    w: Awaited<ReturnType<typeof setup>>,
    model: Awaited<ReturnType<typeof laya>>,
    botId = "bot1",
  ) => {
    seen = [];
    return homeFastPath(
      { plugins: w.plugins, decisions: model.svc, db: {} as never },
      w.a,
      botId,
      "turn off the kitchen light",
    );
  };

  test("a home command is answered by Home Assistant without the AI", async () => {
    const w = await setup({ fastControl: "on" });
    const model = await laya("home_control", 0.9);
    expect(await run(w, model)).toEqual({ reply: "Turned off the light", confidence: 0.9 });
    expect(seen.find((s) => s.path === "/api/conversation/process")?.body).toEqual({
      text: "turn off the kitchen light",
      agent_id: "conversation.home_assistant",
    });
  });

  test("fast control off asks neither Laya nor Home Assistant", async () => {
    const w = await setup({ fastControl: "off" });
    const model = await laya("home_control", 0.9);
    expect(await run(w, model)).toBeUndefined();
    expect(model.calls()).toBe(0);
    expect(seen).toEqual([]);
  });

  test("a message Laya calls 'other' never reaches Home Assistant", async () => {
    const w = await setup({ fastControl: "on" });
    const model = await laya("other", 0.95);
    expect(await run(w, model)).toBeUndefined();
    expect(seen).toEqual([]);
  });

  test("Laya below the confidence threshold falls back to the AI", async () => {
    const w = await setup({ fastControl: "on" });
    const model = await laya("home_control", 0.6);
    expect(await run(w, model)).toBeUndefined();
    expect(seen).toEqual([]);
  });

  test("an Assist error falls back to the AI", async () => {
    assistAnswer = noMatch;
    const w = await setup({ fastControl: "on" });
    const model = await laya("home_control", 0.9);
    expect(await run(w, model)).toBeUndefined();
  });

  test("a bot without the plugin bound gets no fast path", async () => {
    const w = await setup({ fastControl: "on" });
    const model = await laya("home_control", 0.9);
    expect(await run(w, model, "other-bot")).toBeUndefined();
    expect(seen).toEqual([]);
  });

  test("a bot not allowed to use assist gets no fast path", async () => {
    const w = await setup({ fastControl: "on" });
    w.bindings[0]!.toolsMode = "selected";
    w.bindings[0]!.allowedTools = ["states"];
    const model = await laya("home_control", 0.9);
    expect(await run(w, model)).toBeUndefined();
    expect(seen).toEqual([]);
  });
});
