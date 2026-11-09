import { describe, expect, test } from "bun:test";
import { BRIDGE_LIMITS, type BridgeReply } from "@zetta/core/app-bridge";
import { createAppHost, type HostApi, type Prompt } from "./app-host";
import type { CallResult } from "./apps-api";

const TOOLS = [{ name: "items.list" }, { name: "items.remove" }, { name: "items.add" }];
const ok = (value: unknown): CallResult => ({ status: "ok", callId: "c", value, durationMs: 1 });
const asks = (tool: string, input: unknown = { id: "7" }): CallResult => ({
  status: "approval_required",
  callId: `call-${tool}`,
  app: "todo",
  tool,
  kind: "mutation",
  input,
  reason: "A tool that changes something asks first.",
});
const msg = (over: Record<string, unknown> = {}) => ({
  source: "zetta-app",
  id: 1,
  type: "call",
  tool: "items.list",
  ...over,
});
const tick = () => new Promise((r) => setTimeout(r, 0));

function setup(call: HostApi["call"], answer?: HostApi["answer"]) {
  const replies: BridgeReply[] = [];
  const calls: { tool: string; input: unknown }[] = [];
  const answers: { id: string; action: string }[] = [];
  let prompts: readonly Prompt[] = [];
  const host = createAppHost({
    tools: TOOLS,
    api: {
      call: async (tool, input) => {
        calls.push({ tool, input });
        return call(tool, input);
      },
      answer: async (id, action) => {
        answers.push({ id, action });
        return answer ? answer(id, action) : ok("done");
      },
    },
    reply: (r) => void replies.push(r),
    onPrompts: (p) => void (prompts = p),
  });
  return { host, replies, calls, answers, prompts: () => prompts };
}

describe("what reaches the server", () => {
  test("a message that is not a request is ignored: no reply, no call", async () => {
    const s = setup(async () => ok(1));
    for (const junk of [null, "hi", { source: "other" }, msg({ type: "x" }), msg({ id: "1" })])
      await s.host.handle(junk);
    expect(s.replies).toEqual([]);
    expect(s.calls).toEqual([]);
  });
  test("a tool the app does not have is refused to the page and never reaches the server", async () => {
    const s = setup(async () => ok(1));
    await s.host.handle(msg({ tool: "items.drop" }));
    expect(s.replies).toMatchObject([{ id: 1, ok: false, error: { code: "UNKNOWN_TOOL" } }]);
    expect(s.calls).toEqual([]);
  });
  test("a good call goes to the server with its input and the value comes back to the page with the same id", async () => {
    const s = setup(async () => ok([{ id: 1 }]));
    await s.host.handle(msg({ id: 9, input: { q: "x" } }));
    expect(s.calls).toEqual([{ tool: "items.list", input: { q: "x" } }]);
    expect(s.replies).toEqual([{ source: "zetta-host", id: 9, ok: true, value: [{ id: 1 }] }]);
  });
  test("a call with no input sends an empty object", async () => {
    const s = setup(async () => ok(1));
    await s.host.handle(msg());
    expect(s.calls[0]!.input).toEqual({});
  });
});

describe("what comes back", () => {
  test("a tool's failure reaches the page with its code and message", async () => {
    const s = setup(async () => ({
      status: "failed",
      callId: "c",
      error: { code: "NOT_FOUND", message: "No such item." },
      durationMs: 1,
    }));
    await s.host.handle(msg());
    expect(s.replies[0]).toMatchObject({
      ok: false,
      error: { code: "NOT_FOUND", message: "No such item." },
    });
  });
  test("a refusal reaches the page as DENIED with the reason", async () => {
    const s = setup(async () => ({
      status: "denied",
      callId: "c",
      reason: "The owner blocked this tool.",
    }));
    await s.host.handle(msg());
    expect(s.replies[0]).toMatchObject({
      ok: false,
      error: { code: "DENIED", message: "The owner blocked this tool." },
    });
  });
  test("an error from the API reaches the page without leaking more than its message", async () => {
    const boom = Object.assign(new Error("The server is busy."), { code: "BUSY" });
    const s = setup(async () => {
      throw boom;
    });
    await s.host.handle(msg());
    expect(s.replies[0]).toMatchObject({
      ok: false,
      error: { code: "BUSY", message: "The server is busy." },
    });
    const plain = setup(async () => {
      throw "weird";
    });
    await plain.host.handle(msg());
    expect(plain.replies[0]).toMatchObject({ ok: false, error: { code: "FAILED" } });
  });
  test("an answer that is too large for the page becomes an error", async () => {
    const s = setup(async () => ok("a".repeat(BRIDGE_LIMITS.valueChars + 1)));
    await s.host.handle(msg());
    expect(s.replies[0]).toMatchObject({ ok: false, error: { code: "TOO_LARGE" } });
  });
});

describe("a change that needs the person's yes", () => {
  test("the person is asked, with the tool, the kind and the exact input; nothing runs until they answer", async () => {
    const s = setup(async () => asks("items.remove", { id: "7" }));
    const done = s.host.handle(msg({ tool: "items.remove", input: { id: "7" } }));
    await tick();
    expect(s.prompts()).toHaveLength(1);
    expect(s.prompts()[0]).toMatchObject({
      tool: "items.remove",
      kind: "mutation",
      input: { id: "7" },
    });
    expect(s.answers).toEqual([]);
    expect(s.replies).toEqual([]);
    s.prompts()[0]!.allow(false);
    await done;
    expect(s.answers).toEqual([{ id: "call-items.remove", action: "accept" }]);
    expect(s.replies).toMatchObject([{ ok: true }]);
    expect(s.prompts()).toEqual([]);
  });
  test("no: the server is told no, and the page is told the person declined", async () => {
    const s = setup(async () => asks("items.remove"));
    const done = s.host.handle(msg({ tool: "items.remove" }));
    await tick();
    s.prompts()[0]!.refuse();
    await done;
    expect(s.answers).toEqual([{ id: "call-items.remove", action: "decline" }]);
    expect(s.replies).toMatchObject([{ ok: false, error: { code: "DECLINED" } }]);
  });
  test("allowing for this page is for that tool only, and the server still gets every answer", async () => {
    const s = setup(async (tool) => asks(tool));
    const first = s.host.handle(msg({ id: 1, tool: "items.remove" }));
    await tick();
    s.prompts()[0]!.allow(true);
    await first;
    // The same tool again: no prompt, answered at once.
    await s.host.handle(msg({ id: 2, tool: "items.remove" }));
    expect(s.prompts()).toEqual([]);
    expect(s.answers.filter((a) => a.action === "accept")).toHaveLength(2);
    expect(s.replies.map((r) => r.ok)).toEqual([true, true]);
    // Another tool still asks.
    const other = s.host.handle(msg({ id: 3, tool: "items.add" }));
    await tick();
    expect(s.prompts()).toHaveLength(1);
    expect(s.prompts()[0]!.tool).toBe("items.add");
    s.prompts()[0]!.refuse();
    await other;
  });
  test("allowing once does not allow the next call", async () => {
    const s = setup(async (tool) => asks(tool));
    const a = s.host.handle(msg({ id: 1, tool: "items.remove" }));
    await tick();
    s.prompts()[0]!.allow(false);
    await a;
    const b = s.host.handle(msg({ id: 2, tool: "items.remove" }));
    await tick();
    expect(s.prompts()).toHaveLength(1);
    s.prompts()[0]!.refuse();
    await b;
  });
  test("two changes at once are asked one prompt each, in order", async () => {
    const s = setup(async (tool) => asks(tool));
    const a = s.host.handle(msg({ id: 1, tool: "items.remove" }));
    const b = s.host.handle(msg({ id: 2, tool: "items.add" }));
    await tick();
    expect(s.prompts().map((p) => p.tool)).toEqual(["items.remove", "items.add"]);
    s.prompts()[0]!.refuse();
    s.prompts()[0]!.refuse();
    await Promise.all([a, b]);
    expect(s.replies.map((r) => r.id).sort()).toEqual([1, 2]);
  });
  test("an error while the server takes the yes is an error for the page, not a hang", async () => {
    const s = setup(
      async () => asks("items.remove"),
      async () => {
        throw new Error("The call expired.");
      },
    );
    const done = s.host.handle(msg({ tool: "items.remove" }));
    await tick();
    s.prompts()[0]!.allow(false);
    await done;
    expect(s.replies[0]).toMatchObject({ ok: false, error: { message: "The call expired." } });
  });
  test("closing the page refuses the open prompts and cancels their calls", async () => {
    const s = setup(async () => asks("items.remove"));
    const done = s.host.handle(msg({ tool: "items.remove" }));
    await tick();
    s.host.dispose();
    await done;
    expect(s.answers).toEqual([{ id: "call-items.remove", action: "cancel" }]);
    expect(s.prompts()).toEqual([]);
  });
  test("a change that arrives after the page is closed is never shown", async () => {
    const s = setup(async () => asks("items.remove"));
    s.host.dispose();
    await s.host.handle(msg({ tool: "items.remove" }));
    expect(s.prompts()).toEqual([]);
    expect(s.answers.map((a) => a.action)).toEqual(["cancel"]);
  });
});

describe("a page that floods", () => {
  test("only a few calls wait at once; the rest are told to slow down", async () => {
    let release: (() => void) | undefined;
    const gate = new Promise<void>((r) => (release = r));
    const s = setup(async () => {
      await gate;
      return ok(1);
    });
    const all = Array.from({ length: BRIDGE_LIMITS.inFlight + 4 }, (_, i) =>
      s.host.handle(msg({ id: i + 1 })),
    );
    await tick();
    expect(s.calls).toHaveLength(BRIDGE_LIMITS.inFlight);
    expect(s.replies.filter((r) => !r.ok && r.error.code === "RATE_LIMITED")).toHaveLength(4);
    release!();
    await Promise.all(all);
    expect(s.replies.filter((r) => r.ok)).toHaveLength(BRIDGE_LIMITS.inFlight);
  });
});
