import { describe, expect, test } from "bun:test";

import { AUTO_APPLY, isChiefCall, isChiefWrite } from "./kinds";
import { parseTools, toolPreamble } from "../tools";
import { createChief } from ".";

const fence = (kind: string, body: string) => "```zetta:" + kind + "\n" + body + "\n```";
const ID = "018f0000-0000-7000-8000-000000000001";

describe("the chief's setup tools in the prompt", () => {
  test("only the chief is told about them", () => {
    expect(toolPreamble("off", false, true)).toContain("zetta:routine");
    expect(toolPreamble("off", false, true)).toContain("zetta:output_style");
    expect(toolPreamble("off", false, false)).not.toContain("zetta:routine");
    expect(toolPreamble("off", true, false)).not.toContain("zetta:team");
  });
});

describe("parseTools: chief setup blocks", () => {
  test("a valid block of each kind becomes a call and leaves the text", () => {
    const r = parseTools(
      [
        "Done.",
        fence("bot", '{"action":"update","bot":"Researcher","computerMode":"browser"}'),
        fence("folder", '{"action":"create","name":"Marketing"}'),
        fence(
          "routine",
          '{"action":"create","bot":"Researcher","title":"Digest","prompt":"Read the news","timezone":"America/Sao_Paulo","dailyAt":"08:00"}',
        ),
        fence("team", '{"action":"update","team":"Launch","remove":["Writer"]}'),
        fence("output_style", '{"action":"list"}'),
        fence("artifacts", '{"action":"pin","artifact":"Sales"}'),
      ].join("\n"),
    );
    expect(r.rejected).toEqual([]);
    expect(r.calls.map((c) => c.kind)).toEqual([
      "bot",
      "folder",
      "routine",
      "team",
      "output_style",
      "artifacts",
    ]);
    expect(r.text).toBe("Done.");
  });

  test("an update with nothing to change is rejected", () => {
    const r = parseTools(fence("bot", '{"action":"update","bot":"Researcher"}'));
    expect(r.calls).toEqual([]);
    expect(r.rejected[0]).toMatchObject({
      kind: "bot",
      reason: "give at least one field to change",
    });
  });

  test("a routine without a valid time or with an unknown field is rejected", () => {
    const base = '"bot":"R","title":"T","prompt":"P","timezone":"UTC"';
    expect(
      parseTools(fence("routine", `{"action":"create",${base},"dailyAt":"25:00"}`)).calls,
    ).toEqual([]);
    expect(
      parseTools(fence("routine", `{"action":"create",${base},"dailyAt":"08:00","paused":false}`))
        .calls,
    ).toEqual([]);
  });

  test("a routine is switched on by default", () => {
    const r = parseTools(
      fence(
        "routine",
        '{"action":"create","bot":"R","title":"T","prompt":"P","timezone":"UTC","everyMinutes":60}',
      ),
    );
    expect(r.calls[0]?.args).toMatchObject({ activate: true });
  });

  test("a team role with an unknown colour is rejected", () => {
    expect(
      parseTools(fence("team", '{"action":"role_create","name":"Judge","color":"plaid"}')).calls,
    ).toEqual([]);
  });

  test("a team can open a waiting project room; an empty title or a goal over 1000 characters is rejected", () => {
    const ok = parseTools(
      fence("team", '{"action":"open_room","team":"Launch","title":"Blog","goal":"Ship it"}'),
    );
    expect(ok.calls.map((c) => c.args)).toEqual([
      { action: "open_room", team: "Launch", title: "Blog", goal: "Ship it" },
    ]);
    expect(isChiefWrite(ok.calls[0]!)).toBe(true);
    const bad = [
      '{"action":"open_room","team":"Launch","title":""}',
      `{"action":"open_room","team":"Launch","title":"Blog","goal":"${"x".repeat(1001)}"}`,
    ];
    for (const json of bad) expect(parseTools(fence("team", json)).calls).toEqual([]);
  });

  test("create_team takes the team context; a goal over 1000 characters is rejected", () => {
    const ok = parseTools(
      fence("create_team", '{"name":"Launch","goal":"g","context":"Use bun.","members":[]}'),
    );
    expect(ok.calls[0]?.args).toMatchObject({ context: "Use bun." });
    expect(
      parseTools(fence("create_team", `{"name":"L","goal":"${"x".repeat(1001)}"}`)).calls,
    ).toEqual([]);
    expect(parseTools(fence("create_team", '{"name":"L"}')).calls[0]?.args).toMatchObject({
      context: "",
    });
  });

  test("the task board can remove a task by id, with priority and labels on add", () => {
    const r = parseTools(
      [
        fence("task", `{"action":"remove","id":"${ID}"}`),
        fence("task", '{"action":"add","title":"Pay rent","priority":"high","labels":["home"]}'),
        fence("task", '{"action":"add","title":"x","priority":"asap"}'),
      ].join("\n"),
    );
    expect(r.calls.map((c) => c.args)).toEqual([
      { action: "remove", id: ID },
      { action: "add", title: "Pay rent", priority: "high", labels: ["home"] },
    ]);
  });
});

describe("parseTools: integration, hook and room blocks", () => {
  test("valid blocks of each Phase 2 kind become calls", () => {
    const r = parseTools(
      [
        fence("plugins", '{"action":"bind","bot":"Scout","plugin":"gmail"}'),
        fence(
          "mcp_server",
          '{"action":"add","name":"docs","url":"https://docs.example.invalid/mcp"}',
        ),
        fence("skill_library", '{"action":"attach","skill":"code-review","bots":["Scout"]}'),
        fence("hook", `{"action":"update","bot":"Scout","hook":"${ID}","enabled":false}`),
        fence("claude", '{"action":"limits","bot":"Dev","maxBudgetCents":500}'),
        fence("room", '{"action":"set_team","room":"Plan","team":null}'),
      ].join("\n"),
    );
    expect(r.rejected).toEqual([]);
    expect(r.calls).toHaveLength(6);
  });

  test("an address that is not a URL, and a server name with spaces are rejected", () => {
    expect(
      parseTools(fence("mcp_server", '{"action":"add","name":"docs","url":"not a url"}')).calls,
    ).toEqual([]);
    expect(
      parseTools(
        fence("mcp_server", '{"action":"add","name":"My docs","url":"https://a.example.invalid"}'),
      ).calls,
    ).toEqual([]);
  });

  test("a hook update with no change, a budget of zero and a stdio server are rejected", () => {
    expect(parseTools(fence("hook", `{"action":"update","bot":"S","hook":"${ID}"}`)).calls).toEqual(
      [],
    );
    expect(
      parseTools(fence("claude", '{"action":"limits","bot":"D","maxBudgetCents":0}')).calls,
    ).toEqual([]);
    expect(
      parseTools(
        fence(
          "mcp_server",
          '{"action":"add","name":"x","url":"https://a.example.invalid","command":"rm"}',
        ),
      ).calls,
    ).toEqual([]);
  });

  test("a form card written by the model is removed from the text", () => {
    const r = parseTools("Hi\n" + fence("form-card", '{"form":"source_login"}'));
    expect(r.calls).toEqual([]);
    expect(r.text).toBe("Hi");
  });
});

describe("parseTools: preferences, chats, sources and accounts", () => {
  test("valid blocks of each Phase 3 kind become calls", () => {
    const r = parseTools(
      [
        fence("preferences", '{"action":"update","timeFormat":"12h"}'),
        fence("conversation", '{"action":"archive","conversation":"Old plan"}'),
        fence("attention", `{"action":"resolve","item":"${ID}"}`),
        fence("workflow", '{"action":"run","workflow":"Weekly report"}'),
        fence("computer", '{"action":"keyboard","vm":"Banking","layout":"br"}'),
        fence("snapshot", `{"action":"publish","conversation":"${ID}"}`),
        fence(
          "source",
          '{"action":"add","kind":"rss","url":"https://a.example.invalid/f.xml","label":"News"}',
        ),
      ].join("\n"),
    );
    const more = parseTools(
      [
        fence("company_docs", '{"action":"disable"}'),
        fence("connection", '{"action":"add","provider":"openai"}'),
        fence("agenda_sync", '{"action":"settings","enabled":true}'),
        fence("memory_admin", '{"action":"restore","slug":"acme","version":2}'),
      ].join("\n"),
    );
    expect(r.rejected).toEqual([]);
    expect(more.rejected).toEqual([]);
    expect(r.calls.length + more.calls.length).toBe(11);
  });

  test("an email source, a secret in a connection block and a bad keyboard are rejected", () => {
    expect(
      parseTools(
        fence(
          "source",
          '{"action":"add","kind":"email","url":"https://a.example.invalid","label":"Mail"}',
        ),
      ).calls,
    ).toEqual([]);
    expect(
      parseTools(fence("connection", '{"action":"add","provider":"openai","secret":"sk-test-123"}'))
        .calls,
    ).toEqual([]);
    expect(
      parseTools(fence("computer", '{"action":"keyboard","vm":"B","layout":"klingon"}')).calls,
    ).toEqual([]);
    expect(parseTools(fence("preferences", '{"action":"update"}')).calls).toEqual([]);
  });

  test("looking at a snapshot or the company documents changes nothing; publishing does", () => {
    expect(isChiefWrite({ kind: "snapshot", args: { action: "preview" } })).toBe(false);
    expect(isChiefWrite({ kind: "company_docs", args: { action: "status" } })).toBe(false);
    expect(isChiefWrite({ kind: "snapshot", args: { action: "publish" } })).toBe(true);
    expect(isChiefWrite({ kind: "connection", args: { action: "add" } })).toBe(true);
  });
});

describe("which calls change something", () => {
  const call = (kind: string, args: Record<string, unknown>) => ({ kind, args });
  test("list, get and export read; everything else is a write that waits for the user", () => {
    expect(isChiefWrite(call("routine", { action: "list" }))).toBe(false);
    expect(isChiefWrite(call("bot", { action: "get" }))).toBe(false);
    expect(isChiefWrite(call("output_style", { action: "export" }))).toBe(false);
    expect(isChiefWrite(call("routine", { action: "pause" }))).toBe(true);
    expect(isChiefWrite(call("artifacts", { action: "remove" }))).toBe(true);
    expect(isChiefWrite(call("memory", { action: "write" }))).toBe(false);
    // Testing a plugin and trying a hook change nothing.
    expect(isChiefWrite(call("plugins", { action: "test" }))).toBe(false);
    expect(isChiefWrite(call("hook", { action: "dry_run" }))).toBe(false);
  });
  test("removing a task belongs to the chief, adding one does not", () => {
    expect(isChiefCall(call("task", { action: "remove" }))).toBe(true);
    expect(isChiefCall(call("task", { action: "add" }))).toBe(false);
    expect(isChiefCall(call("browser", { action: "open" }))).toBe(false);
  });
});

describe("zetta:connection", () => {
  const actor = { userId: "u1", isAdmin: false } as never;
  const who = { id: "b1", kind: "chief" } as never;
  const chief = (configured: boolean) =>
    createChief({ connections: { configured: () => configured } as never } as never);

  test("add opens a form and tells the chief it never sees the key", async () => {
    const out = await chief(true).run(actor, who, "connection", {
      action: "add",
      provider: "openai",
    });
    expect(out).toEqual({
      card: {
        form: "connection",
        botId: null,
        botName: null,
        prefill: { provider: "openai", label: "openai" },
      },
      text: expect.stringContaining("You never see the key"),
    });
  });

  test("a server without an encryption key says accounts are off", async () => {
    const out = await chief(false).run(actor, who, "connection", {
      action: "add",
      provider: "openai",
    });
    expect(out).toEqual({ error: expect.stringContaining("turned off") });
  });
});

describe("parseTools: the last chief tools", () => {
  test("valid blocks become calls, including a bot argument on setup and inbound", () => {
    const r = parseTools(
      [
        fence("setup", '{"plugin":"gmail","bot":"Scout"}'),
        fence("inbound", '{"action":"status","plugin":"whatsapp","bot":"Support"}'),
        fence(
          "inbound",
          '{"action":"propose","plugin":"whatsapp","bot":"Support","incoming":"on"}',
        ),
        fence("browser_profile", '{"action":"reset","profile":"b-1"}'),
        fence(
          "inbound_route",
          '{"action":"interval","bot":"Support","plugin":"whatsapp","seconds":30}',
        ),
        fence("admin", '{"action":"invite"}'),
        fence("source", '{"action":"add_login","kind":"email"}'),
      ].join("\n"),
    );
    expect(r.rejected).toEqual([]);
    expect(r.calls).toHaveLength(7);
  });

  test("a poll faster than 20 seconds, a decision with one option and an unknown admin action are rejected", () => {
    expect(
      parseTools(fence("inbound_route", '{"action":"interval","bot":"S","plugin":"w","seconds":5}'))
        .calls,
    ).toEqual([]);
    expect(
      parseTools(
        fence(
          "decision",
          '{"action":"set","bot":"S","config":{"enabled":true,"question":"Q","options":[{"label":"a","description":"d","action":"stop"}],"minConfidencePct":50}}',
        ),
      ).calls,
    ).toEqual([]);
    expect(parseTools(fence("admin", '{"action":"make_me_admin"}')).calls).toEqual([]);
  });
});

describe("administrator forms and browser profiles", () => {
  const who = { id: "b1", kind: "chief" } as never;
  test("an administrator gets the invitation form, anyone else gets a refusal", async () => {
    const chief = createChief({} as never);
    const asAdmin = await chief.run({ userId: "u1", isAdmin: true } as never, who, "admin", {
      action: "invite",
    });
    expect(asAdmin).toMatchObject({ card: { form: "invite", botId: null } });
    const asMember = await chief.run({ userId: "u2", isAdmin: false } as never, who, "admin", {
      action: "invite",
    });
    expect(asMember).toEqual({ error: "only an administrator can do this." });
  });

  test("resetting a browser profile is a card, and approving it resets only that profile", async () => {
    const reset: string[] = [];
    const computer = {
      profiles: async () => [{ name: "b-1", mode: "persistent", revoked: false }],
      reset: async (_u: string, p: string) => void reset.push(p),
      revokeProfile: async () => {},
    };
    const chief = createChief({ computer } as never);
    const actor = { userId: "u1", isAdmin: false } as never;
    const out = await chief.run(actor, who, "browser_profile", { action: "reset", profile: "b-1" });
    expect(reset).toEqual([]);
    expect(out).toMatchObject({ plan: { title: "Reset the browser profile b-1" } });
    await chief.apply(actor, (out as unknown as { plan: { patch: never } }).plan.patch);
    expect(reset).toEqual(["b-1"]);
  });

  test("a profile that does not exist is refused", async () => {
    const chief = createChief({
      computer: { profiles: async () => [], reset: async () => {}, revokeProfile: async () => {} },
    } as never);
    const out = await chief.run({ userId: "u1", isAdmin: false } as never, who, "browser_profile", {
      action: "reset",
      profile: "ghost",
    });
    expect(out).toEqual({
      error: 'no browser profile called "ghost". Use a name or id from the list.',
    });
  });
});

describe("what the end of a turn may approve for the user", () => {
  test("only these proposals apply on their own; a grant to a bot, goals, skills and the chief's setup changes wait for a click", () => {
    expect([...AUTO_APPLY]).toEqual([
      "config",
      "create_bot",
      "create_routine",
      "create_workflow",
      "create_vm",
      "open_discussion",
      "start_loop",
    ]);
  });
});
