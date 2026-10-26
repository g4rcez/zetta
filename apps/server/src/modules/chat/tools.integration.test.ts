import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { user } from "@zetta/db/schema/auth";
import { membership } from "@zetta/db/schema/identity";
import { createApp } from "../../app";
import { cleanupTestUsers } from "../../test-support/db-cleanup";
import { createIdentityAccess } from "../identity/access";
import { parseTools } from "./tools";
import { createChatService } from "./service";
import { createFeaturesService } from "../features/service";
import { ComputerError } from "../computer/service";

describe("parseTools", () => {
  test("extracts valid blocks, strips them, and drops malformed or unknown ones", () => {
    const r = parseTools('Hello\n```zetta:remember\n{"content":"likes tea"}\n```\nbye ```zetta:remember\nnot json\n```\n```zetta:config\n{"botId":"x","patch":{}}\n```');
    expect(r.calls).toEqual([{ kind: "remember", args: { target: "memory", ops: [{ op: "add", content: "likes tea" }] } }]);
    expect(r.text).not.toContain("zetta:");
  });
});

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const ids = [`tool-a-${crypto.randomUUID()}`, `tool-b-${crypto.randomUUID()}`];
const [A, B] = ids as [string, string];

suite("bot tools against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const access = createIdentityAccess({ api: { async getSession({ headers }) { const id = headers.get("x-test-user"); return id ? { user: { id } } : null; } } }, async () => ({ isAdmin: false }));
  let script: string[] = []; const prompts: string[] = [];
  const fakeRun = Object.assign(async (t: { prompt: string }) => { prompts.push(t.prompt); return { text: script.shift() ?? "done", stopped: false }; },
    { stream: async function* (t: { prompt: string }) { prompts.push(t.prompt); yield script.shift() ?? "done"; } });
  const calls: string[] = []; let human = false;
  const fakeComputer = { epochOf: () => 0, start: async () => ({}), text: async () => "PAGE TEXT", act: async (_u: string, _p: string, by: string, a: { type: string }) => { if (human && by === "agent") throw new ComputerError("HUMAN_IN_CONTROL"); calls.push(a.type); return {}; } };
  const features = createFeaturesService(db, fakeRun as never);
  const app = createApp({ auth: { handler: () => new Response("n/a"), api: { getSession: async () => null } } as never, chat: { access, chat: createChatService(db, fakeRun as never, undefined, fakeComputer as never, undefined, undefined, { routine: features.routines.create as never, workflow: features.workflows.save as never }) }, features: { access, features }, webOrigin: "http://web.test", desktopOrigins: [], drain: () => {} });
  const call = async (as: string, method: string, path: string, body?: unknown) => {
    const r = await app.handle(new Request(`http://localhost${path}`, { method, headers: { "x-test-user": as, origin: "http://web.test", "content-type": "application/json" }, body: body ? JSON.stringify(body) : undefined }));
    return { status: r.status, json: (await r.json().catch(() => ({}))) as any };
  };
  beforeAll(async () => {
    const now = new Date();
    await db.insert(user).values(ids.map((id) => ({ id, name: id, email: `${id}@t.test`, emailVerified: true, createdAt: now, updatedAt: now })));
    await db.insert(membership).values(ids.map((userId) => ({ userId, status: "active" as const, joinedAt: now, updatedAt: now })));
  });
  afterAll(async () => { await cleanupTestUsers(db, ids); });
  const setup = async (as: string, name: string) => {
    const bot = (await call(as, "POST", "/api/bots", { name })).json.bot as { id: string };
    const c = (await call(as, "POST", "/api/conversations", { botId: bot.id })).json.conversation.id as string;
    return { bot, c, say: (content: string) => call(as, "POST", `/api/conversations/${c}/messages`, { content }) };
  };

  test("remember and instruction blocks self-teach; config blocks only propose, applied on approval with version check", async () => {
    const { bot, say } = await setup(A, "Learner");
    script = ['Done.\n```zetta:remember\n{"content":"prefers metric units"}\n```\n```zetta:instruction\n{"title":"Expense report","body":"Sum by category."}\n```'];
    const r = await say("learn");
    expect(r.json.assistant.content).toContain("Remembered"); expect(r.json.assistant.content).not.toContain("zetta:");
    expect((await call(A, "GET", "/api/memories")).json.memories.map((m: { content: string }) => m.content)).toContain("prefers metric units");
    expect((await call(A, "GET", "/api/instructions")).json.instructions).toHaveLength(0); // an instruction is a proposal until approved
    const ip = (await call(A, "GET", "/api/proposals")).json.proposals.find((p: { kind: string }) => p.kind === "create_instruction");
    expect(ip).toBeTruthy(); expect((await call(A, "POST", `/api/proposals/${ip.id}/decision`, { approve: true })).json.status).toBe("approved");
    expect((await call(A, "GET", "/api/instructions")).json.instructions).toHaveLength(1);
    script = [`I suggest a tweak.\n\`\`\`zetta:config\n{"botId":"${bot.id}","patch":{"personality":"concise"}}\n\`\`\``];
    await say("improve yourself");
    const props = (await call(A, "GET", "/api/proposals")).json.proposals;
    expect(props).toHaveLength(1); expect(props[0].diff[0]).toMatchObject({ field: "personality", to: "concise" });
    expect((await call(A, "GET", "/api/bots")).json.bots.find((b: { id: string }) => b.id === bot.id).personality).toBe(""); // not applied yet
    expect((await call(B, "POST", `/api/proposals/${props[0].id}/decision`, { approve: true })).status).toBe(404);
    expect((await call(A, "POST", `/api/proposals/${props[0].id}/decision`, { approve: true })).json.status).toBe("approved");
    expect((await call(A, "GET", "/api/bots")).json.bots.find((b: { id: string }) => b.id === bot.id).personality).toBe("concise");
    // a stale proposal (bot edited meanwhile) is not applied
    script = [`\`\`\`zetta:config\n{"botId":"${bot.id}","patch":{"instructions":"X"}}\n\`\`\``]; await say("again");
    const p2 = (await call(A, "GET", "/api/proposals")).json.proposals[0];
    await call(A, "PATCH", `/api/bots/${bot.id}`, { expectedVersion: 2, patch: { description: "edit" } });
    expect((await call(A, "POST", `/api/proposals/${p2.id}/decision`, { approve: true })).json.status).toBe("stale");
  });

  test("a bot cannot propose changes to another user's bot", async () => {
    const mine = await setup(A, "Proposer"); const theirs = await setup(B, "Victim");
    script = [`\`\`\`zetta:config\n{"botId":"${theirs.bot.id}","patch":{"personality":"pwned"}}\n\`\`\``];
    const r = await mine.say("go");
    expect(r.json.assistant.content).toContain("cannot edit");
    expect((await call(B, "GET", "/api/proposals")).json.proposals).toHaveLength(0);
  });

  test("browser blocks run in a bounded loop and feed results back; human takeover hands off with attention", async () => {
    const { bot: surfer, say } = await setup(A, "Surfer");
    await db.$client.query("update bot set onboarded = true where id = $1", [surfer.id]); // browser tools need a ready bot
    calls.length = 0; prompts.length = 0;
    script = ['```zetta:browser\n{"action":"open","url":"https://example.com"}\n```', 'The page says PAGE TEXT.'];
    const r = await say("look at example.com");
    expect(calls).toEqual(["open"]);
    expect(prompts.some((p) => p.includes("Tool results") && p.includes("PAGE TEXT"))).toBe(true);
    expect(r.json.assistant.content).toContain("The page says PAGE TEXT.");
    // endless browsing is capped
    calls.length = 0; script = Array.from({ length: 20 }, () => '```zetta:browser\n{"action":"click_text","text":"next"}\n```');
    await say("loop forever");
    expect(calls.length).toBeLessThanOrEqual(5);
    // human in control: agent actions are refused and the bot is told to wait
    human = true; script = ['```zetta:browser\n{"action":"open","url":"https://example.com"}\n```'];
    expect((await say("try")).json.assistant.content).toContain("A person is controlling");
    human = false; script = ['```zetta:handoff\n{"reason":"Please sign in"}\n```'];
    await say("need login");
    const items = (await call(A, "GET", "/api/attention")).json.items as { title: string; nextAction: string }[];
    expect(items.some((i) => i.title.includes("take over the browser") && i.nextAction.includes("hand it back"))).toBe(true);
  });

  test("bot-proposed creations (bot, routine, workflow) are only summaries until approved, exactly once, and unready bots cannot browse", async () => {
    const { bot, say } = await setup(A, "Builder");
    const chiefish = bot.id;
    script = ['```zetta:create_bot\n{"name":"Researcher","personality":"curious"}\n```\n```zetta:create_routine\n{"botId":"' + chiefish + '","title":"Brief","prompt":"brief me","timezone":"UTC","everyMinutes":60}\n```\n```zetta:create_workflow\n{"name":"Flow","graph":{"start":"a","nodes":{"a":{"type":"prompt","botId":"' + chiefish + '","template":"x","next":"e"},"e":{"type":"end"}}}}\n```'];
    await say("set things up");
    const props = (await call(A, "GET", "/api/proposals")).json.proposals.filter((p: { kind: string }) => p.kind !== "config" && p.kind !== "create_instruction");
    expect(props.map((p: { kind: string }) => p.kind).sort()).toEqual(["create_bot", "create_routine", "create_workflow"]);
    expect((await call(A, "GET", "/api/routines")).json.routines.some((r: { title: string }) => r.title === "Brief")).toBe(false); // nothing exists yet
    expect((await call(A, "GET", "/api/bots")).json.bots.some((b: { name: string }) => b.name === "Researcher")).toBe(false);
    for (const p of props) {
      expect((await call(B, "POST", `/api/proposals/${p.id}/decision`, { approve: true })).status).toBe(404);
      const both = await Promise.all([call(A, "POST", `/api/proposals/${p.id}/decision`, { approve: true }), call(A, "POST", `/api/proposals/${p.id}/decision`, { approve: true })]);
      expect(both.map((x) => x.status).sort()).toEqual([200, 404]); // approved exactly once
    }
    expect((await call(A, "GET", "/api/bots")).json.bots.filter((b: { name: string }) => b.name === "Researcher")).toHaveLength(1);
    expect((await call(A, "GET", "/api/routines")).json.routines.filter((r: { title: string }) => r.title === "Brief")).toHaveLength(1);
    expect((await call(A, "GET", "/api/workflows")).json.workflows.filter((w: { name: string }) => w.name === "Flow")).toHaveLength(1);
    // an unready bot is refused browser tools
    calls.length = 0; script = ['```zetta:browser\n{"action":"open","url":"https://example.com"}\n```'];
    expect((await say("browse")).json.assistant.content).toContain("after this bot finishes onboarding"); expect(calls).toHaveLength(0);
  });
});
