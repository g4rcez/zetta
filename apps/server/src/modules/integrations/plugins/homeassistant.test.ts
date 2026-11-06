import { afterAll, beforeAll, beforeEach, describe, expect, test } from "bun:test";
import { createDecisionService } from "../../decisions/service";
import { configureHomeAssistant } from "./homeassistant";
import { forgetHomeCatalogs } from "./homeassistant-catalog";
import { homeFastPath } from "./homeassistant-fast";
import { actor, world } from "./test-world";

/** A fake Home Assistant on loopback: the real external boundary of the plugin. */
type Seen = { method: string; path: string; auth: string | null; body: unknown };
let seen: Seen[] = [];
let assistAnswer: unknown = {};
/** When set, Assist understands only this language and answers "no match" for every other one. */
let assistOnlyIn: string | undefined;
/** Fake failures: the areas template is refused, or the light service is refused. */
let templateRefused = false;
let lightRefused = false;
const STATES = [
  { entity_id: "light.kitchen", state: "on", attributes: { friendly_name: "Kitchen light" } },
  { entity_id: "light.hall", state: "off", attributes: { friendly_name: "Hall light" } },
  {
    entity_id: "light.lampada_neo_40w",
    state: "off",
    attributes: { friendly_name: "Lâmpada NEO 40W", supported_color_modes: ["color_temp", "hs"] },
  },
  { entity_id: "sensor.temp", state: "21", attributes: {} },
  {
    entity_id: "media_player.living_tv",
    state: "on",
    attributes: {
      friendly_name: "Living TV",
      // turn on 128 + turn off 256 + volume set 4 + volume step 1024 + select source 2048
      supported_features: 3460,
      source_list: ["HDMI 1", "Netflix"],
    },
  },
  { entity_id: "scene.movie", state: "scening", attributes: { friendly_name: "Movie night" } },
];
const AREAS = [{ name: "Living room", entities: ["media_player.living_tv"] }];
const SERVICES = [
  { domain: "light", services: { turn_on: {}, turn_off: {}, toggle: {} } },
  {
    domain: "media_player",
    services: { turn_on: {}, turn_off: {}, volume_set: {}, select_source: {} },
  },
  { domain: "scene", services: { turn_on: {} } },
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
    if (url.pathname.startsWith("/api/states/"))
      return Response.json(STATES.find((x) => url.pathname.endsWith(x.entity_id)) ?? {});
    if (url.pathname === "/api/services") return Response.json(SERVICES);
    if (url.pathname === "/api/template")
      return templateRefused
        ? new Response("no", { status: 403 })
        : new Response(JSON.stringify(AREAS));
    if (lightRefused && url.pathname.startsWith("/api/services/light/"))
      return new Response("bad", { status: 400 });
    if (url.pathname === "/api/services/light/turn_off")
      return Response.json([{ entity_id: "light.kitchen", state: "off", attributes: {} }]);
    if (req.method === "POST" && url.pathname.startsWith("/api/services/"))
      return Response.json([]);
    if (url.pathname === "/api/conversation/process") {
      const language = (body as { language?: string } | undefined)?.language;
      return Response.json(assistOnlyIn && language !== assistOnlyIn ? noMatch : assistAnswer);
    }
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
  assistOnlyIn = undefined;
  templateRefused = false;
  lightRefused = false;
  forgetHomeCatalogs();
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
      total: 3,
      states: [
        { entity_id: "light.kitchen", name: "Kitchen light", state: "on" },
        { entity_id: "light.hall", name: "Hall light", state: "off" },
        { entity_id: "light.lampada_neo_40w", name: "Lâmpada NEO 40W", state: "off" },
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

const assisted = () => seen.some((x) => x.path === "/api/conversation/process");
const posts = () => seen.filter((x) => x.method === "POST" && x.path.startsWith("/api/services/"));

describe("home fast path: Laya and Assist", () => {
  // A sentence the parser has no rule for, so Laya and Assist decide.
  const COZY = "make it cozy in here";
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
      COZY,
    );
  };

  test("a home command the parser does not know is answered by Home Assistant without the AI", async () => {
    const w = await setup({ fastControl: "on" });
    const model = await laya("home_control", 0.9);
    expect(await run(w, model)).toEqual({ reply: "Turned off the light", confidence: 0.9 });
    expect(seen.find((s) => s.path === "/api/conversation/process")?.body).toEqual({
      text: COZY,
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
    expect(assisted()).toBe(false);
  });

  test("Laya below the confidence threshold falls back to the AI", async () => {
    const w = await setup({ fastControl: "on" });
    const model = await laya("home_control", 0.6);
    expect(await run(w, model)).toBeUndefined();
    expect(assisted()).toBe(false);
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

  test("a bot not allowed to use any tool of the plugin gets no fast path", async () => {
    const w = await setup({ fastControl: "on" });
    w.bindings[0]!.toolsMode = "selected";
    w.bindings[0]!.allowedTools = ["states"];
    const model = await laya("home_control", 0.9);
    expect(await run(w, model)).toBeUndefined();
    expect(seen).toEqual([]);
  });
});

describe("home parser path", () => {
  const go = async (
    text: string,
    opts: {
      fields?: Record<string, string>;
      languages?: string[];
      now?: () => number;
      laya?: "on" | "off";
    } = {},
  ) => {
    const w = await setup({ fastControl: "on", ...opts.fields });
    const model = await laya("home_control", 0.9);
    const decisions =
      opts.laya === "off"
        ? createDecisionService(undefined, undefined, { mode: "off" })
        : model.svc;
    if (opts.languages) decisions.setMode("on", { languages: opts.languages });
    seen = [];
    const result = await homeFastPath(
      { plugins: w.plugins, decisions, db: {} as never, now: opts.now },
      w.a,
      "bot1",
      text,
    );
    return { result, w, model };
  };

  test("a switch command calls the service itself, with no Laya and no Assist", async () => {
    const { result, model } = await go("turn off the kitchen light");
    expect(result).toEqual({ reply: "Kitchen light: turned off.", confidence: 1 });
    expect(posts().map((x) => [x.path, x.body])).toEqual([
      ["/api/services/light/turn_off", { entity_id: "light.kitchen" }],
    ]);
    expect(assisted()).toBe(false);
    expect(model.calls()).toBe(0);
  });

  test("a volume command takes the number from the sentence", async () => {
    const { result } = await go("set the TV volume to 30");
    expect(result?.reply).toBe("Living TV: set to 30%.");
    expect(posts().map((x) => [x.path, x.body])).toEqual([
      [
        "/api/services/media_player/volume_set",
        { volume_level: 0.3, entity_id: "media_player.living_tv" },
      ],
    ]);
  });

  test("an input name in the sentence picks the source", async () => {
    await go("change the TV input to Netflix");
    expect(posts().map((x) => x.body)).toEqual([
      { source: "Netflix", entity_id: "media_player.living_tv" },
    ]);
  });

  test("a name written without spaces still finds the device", async () => {
    const { result } = await go("turn on Neo40W");
    expect(result?.reply).toBe("Lâmpada NEO 40W: turned on.");
    expect(posts().map((x) => [x.path, x.body])).toEqual([
      ["/api/services/light/turn_on", { entity_id: "light.lampada_neo_40w" }],
    ]);
  });

  test("a Portuguese message gets a Portuguese reply, and the digits of the name are no brightness", async () => {
    const { result } = await go("Apague a luz Neo 40W");
    expect(result?.reply).toBe("Lâmpada NEO 40W: desligado.");
    expect(posts().map((x) => [x.path, x.body])).toEqual([
      ["/api/services/light/turn_off", { entity_id: "light.lampada_neo_40w" }],
    ]);
  });

  test("a brightness after the device name is still read", async () => {
    const { result } = await go("deixe a Neo 40W em 30%");
    expect(result?.reply).toBe("Lâmpada NEO 40W: ajustado para 30%.");
    expect(posts().map((x) => x.body)).toEqual([
      { brightness_pct: 30, entity_id: "light.lampada_neo_40w" },
    ]);
  });

  test("a scene is activated", async () => {
    const { result } = await go("start the movie night scene");
    expect(result?.reply).toBe("Movie night: done.");
    expect(posts().map((x) => x.path)).toEqual(["/api/services/scene/turn_on"]);
  });

  test("a question reads the live state", async () => {
    const { result } = await go("is the kitchen light on");
    expect(result?.reply).toBe("Kitchen light: on.");
    expect(posts()).toEqual([]);
    expect(assisted()).toBe(false);
  });

  test("it works with Laya turned off, and then nothing else is sent to Assist", async () => {
    const { result } = await go("turn off the kitchen light", { laya: "off" });
    expect(result?.reply).toBe("Kitchen light: turned off.");
    const cozy = await go("make it cozy in here", { laya: "off" });
    expect(cozy.result).toBeUndefined();
    expect(assisted()).toBe(false);
  });

  test("a command with no number falls back to Assist and calls no service", async () => {
    const { result } = await go("set the TV volume");
    expect(result?.reply).toBe("Turned off the light");
    expect(posts()).toEqual([]);
    expect(assisted()).toBe(true);
  });

  test("a device the home does not have falls back to Assist", async () => {
    const { result } = await go("turn off the bathroom light");
    expect(result?.reply).toBe("Turned off the light");
    expect(posts()).toEqual([]);
    expect(assisted()).toBe(true);
  });

  test("two lights that fit equally are not guessed", async () => {
    await go("turn on the light");
    expect(posts()).toEqual([]);
    expect(assisted()).toBe(true);
  });

  test("a service Home Assistant refuses falls back to Assist", async () => {
    lightRefused = true;
    const { result } = await go("turn off the kitchen light");
    expect(result?.reply).toBe("Turned off the light");
    expect(assisted()).toBe(true);
  });

  test("a bot not allowed to call services only gets Assist", async () => {
    const w = await setup({ fastControl: "on" });
    w.bindings[0]!.toolsMode = "selected";
    w.bindings[0]!.allowedTools = ["assist"];
    const model = await laya("home_control", 0.9);
    seen = [];
    const result = await homeFastPath(
      { plugins: w.plugins, decisions: model.svc, db: {} as never },
      w.a,
      "bot1",
      "turn off the kitchen light",
    );
    expect(result?.reply).toBe("Turned off the light");
    expect(seen.map((x) => x.path)).toEqual(["/api/conversation/process"]);
  });

  test("the home is read once and again only after half an hour", async () => {
    let clock = 1_000_000;
    const now = () => clock;
    const reads = () => seen.filter((x) => x.path === "/api/states").length;
    const w = await setup({ fastControl: "on" });
    const model = await laya("home_control", 0.9);
    const ask = () =>
      homeFastPath(
        { plugins: w.plugins, decisions: model.svc, db: {} as never, now },
        w.a,
        "bot1",
        "turn off the kitchen light",
      );
    seen = [];
    await ask();
    await ask();
    expect(reads()).toBe(1);
    clock += 31 * 60_000;
    await ask();
    await Bun.sleep(50);
    expect(reads()).toBe(2);
  });

  test("a refused areas template still leaves a working catalog", async () => {
    templateRefused = true;
    const { result } = await go("turn off the kitchen light");
    expect(result?.reply).toBe("Kitchen light: turned off.");
  });
});

describe("home assist languages", () => {
  const ask = async (language: string) => {
    const w = await setup({ language });
    seen = [];
    const result = await w.plugins.callTool(w.a, "bot1", "homeassistant", "assist", {
      text: "apaga a luz da cozinha",
    });
    const languages = seen
      .filter((s) => s.path === "/api/conversation/process")
      .map((s) => (s.body as { language?: string }).language);
    return { result, languages };
  };

  test("the next language answers when the first one does not match", async () => {
    assistOnlyIn = "en";
    const { result, languages } = await ask("pt-BR,en");
    expect(languages).toEqual(["pt-BR", "en"]);
    expect(String(result)).toContain("Turned off the light");
  });

  test("the first language that matches stops the search", async () => {
    assistOnlyIn = "en";
    const { languages } = await ask("en,pt-BR");
    expect(languages).toEqual(["en"]);
  });

  test("a single saved language works as before", async () => {
    const { languages } = await ask("pt-BR");
    expect(languages).toEqual(["pt-BR"]);
  });

  test("an empty list sends no language", async () => {
    const { languages } = await ask("");
    expect(languages).toEqual([undefined]);
  });

  test("invalid and repeated tags are dropped", async () => {
    const { languages } = await ask("pt-BR, ../x ,pt-BR,en");
    expect(languages).toEqual(["pt-BR"]);
  });
});
