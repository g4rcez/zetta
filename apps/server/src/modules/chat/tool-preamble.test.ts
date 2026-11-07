import { describe, expect, test } from "bun:test";
import { parseTools, toolPreamble } from "./tools";

describe("toolPreamble", () => {
  test("computer tools are only described when the owner enabled them", () => {
    expect(toolPreamble("off")).not.toContain("zetta:browser");
    expect(toolPreamble()).not.toContain("zetta:desktop");
    expect(toolPreamble("browser")).toContain("zetta:browser");
    expect(toolPreamble("browser")).toContain("zetta:handoff");
    expect(toolPreamble("browser")).not.toContain("zetta:desktop");
    expect(toolPreamble("desktop")).toContain("zetta:desktop");
  });
  test("a bot knows which browser is which, and is steered to the user's own computer when fetching is blocked", () => {
    expect(toolPreamble("browser")).toContain(
      "a separate browser on the Zetta server, with none of the user's sign-ins",
    );
    const desktop = toolPreamble("desktop");
    expect(desktop).toContain("the browser inside the user's own computer (a VM)");
    expect(desktop).toContain(
      "when WebFetch, curl or zetta:browser are blocked: a blocked fetch is not a reason to stop",
    );
    expect(desktop).toContain("send navigate and read together in one reply");
    expect(desktop).toContain(
      "If a site needs a sign-in or shows a CAPTCHA, the computer works: say what you see, try another address of the same source once",
    );
    expect(desktop).toContain(
      "If the read shows about:blank or an old page, read once more before you report a failure",
    );
    expect(desktop).toContain(
      "never start, stop or control a computer with shell tools (utmctl, docker, podman, VNC)",
    );
  });
  test("every bot is told to pick the method itself", () => {
    expect(toolPreamble("off")).toContain("Never ask the user to choose a method");
    expect(toolPreamble("desktop", true, true)).toContain("Pick it yourself");
  });
  test("every bot is told to split long work into small tasks and report each one", () => {
    expect(toolPreamble("off")).toContain("Split work of more than 2 steps into small tasks");
    expect(toolPreamble("desktop", true)).toContain(
      "send its tool block in your reply so the user sees the action",
    );
  });
  test("code access is only described when the owner enabled it", () => {
    expect(toolPreamble("off")).not.toContain("Code access");
    expect(toolPreamble("off", true)).toContain("git clone");
    expect(toolPreamble("browser", true)).toContain("zetta:browser");
    expect(toolPreamble("browser", true)).toContain("Code access");
  });
});

describe("zetta:plan", () => {
  const fence = (body: string) => "```zetta:plan\n" + body + "\n```";
  test("every bot is told how to announce a checklist", () => {
    expect(toolPreamble("off")).toContain("zetta:plan");
  });
  test("a plan is not a call: it is removed from the text and defaults each status to pending", () => {
    const r = parseTools(
      "Starting.\n" +
        fence('{"steps":[{"id":"1","title":"Read","status":"active"},{"id":"2","title":"Chart"}]}'),
    );
    expect(r.calls).toEqual([]);
    expect(r.rejected).toEqual([]);
    expect(r.text).toBe("Starting.");
    expect(r.plan).toEqual([
      { id: "1", title: "Read", status: "active" },
      { id: "2", title: "Chart", status: "pending" },
    ]);
  });
  test("the last plan block of a reply wins", () => {
    const r = parseTools(
      fence('{"steps":[{"id":"1","title":"Old"}]}') +
        "\n" +
        fence('{"steps":[{"id":"1","title":"New","status":"done"}]}'),
    );
    expect(r.plan).toEqual([{ id: "1", title: "New", status: "done" }]);
  });
  test.each([
    ["empty", '{"steps":[]}'],
    ["not JSON", "not json"],
    ["unknown status", '{"steps":[{"id":"1","title":"X","status":"started"}]}'],
  ])("a %s plan is dropped without a rejection", (_name, body) => {
    const r = parseTools("Hi\n" + fence(body));
    expect(r.plan).toBeUndefined();
    expect(r.rejected).toEqual([]);
    expect(r.text).toBe("Hi");
  });
  test("a plan does not count toward the eight-block limit", () => {
    const remember = '```zetta:memory\n{"action":"search","query":"x"}\n```\n';
    const r = parseTools(remember.repeat(8) + fence('{"steps":[{"id":"1","title":"Only"}]}'));
    expect(r.calls).toHaveLength(8);
    expect(r.rejected).toEqual([]);
    expect(r.plan).toEqual([{ id: "1", title: "Only", status: "pending" }]);
  });
});

describe("escalation", () => {
  test("a bot that is not the chief is taught to escalate instead of asking the user", () => {
    expect(toolPreamble("off")).toContain("what blocks you");
    expect(toolPreamble("desktop", true)).toContain("what blocks you");
    expect(toolPreamble("off", true, true)).not.toContain("what blocks you");
  });
  test("escalate parses with a problem and what was tried, and rejects extra fields", () => {
    const ok = parseTools(
      '```zetta:escalate\n{"problem":"Reddit blocks fetches","tried":"WebFetch"}\n```',
    );
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.kind).toBe("escalate");
    expect(
      parseTools('```zetta:escalate\n{"problem":"x","tried":"y","ask":"user"}\n```').calls,
    ).toHaveLength(0);
  });
});

describe("chief tools", () => {
  test("only the chief is taught how to edit other bots' permissions", () => {
    expect(toolPreamble("off", true)).not.toContain("zetta:bot_claude");
    expect(toolPreamble("off", true, true)).toContain("zetta:bot_claude");
    expect(toolPreamble("off", false, true).endsWith("Only use a tool when it is needed.")).toBe(
      true,
    );
  });
  test("bot_claude parses with rules and rejects unknown fields", () => {
    const ok = parseTools(
      '```zetta:bot_claude\n{"bot":"components","allow":["Bash(gh pr create:*)"]}\n```',
    );
    expect(ok.calls).toHaveLength(1);
    expect(ok.calls[0]!.kind).toBe("bot_claude");
    expect(parseTools('```zetta:bot_claude\n{"bot":"x","nope":1}\n```').calls).toHaveLength(0);
  });
  test("artifact needs exactly one of path or content", () => {
    expect(toolPreamble()).toContain("zetta:artifact");
    const path = parseTools('```zetta:artifact\n{"title":"Sales","path":"out/sales.html"}\n```');
    expect(path.calls).toHaveLength(1);
    expect(path.calls[0]!.kind).toBe("artifact");
    expect(
      parseTools('```zetta:artifact\n{"title":"Note","content":"hello"}\n```').calls,
    ).toHaveLength(1);
    expect(
      parseTools('```zetta:artifact\n{"title":"Both","path":"a","content":"b"}\n```').calls,
    ).toHaveLength(0);
    expect(parseTools('```zetta:artifact\n{"title":"None"}\n```').calls).toHaveLength(0);
  });
  test("a dropped block is reported with its reason instead of vanishing", () => {
    expect(
      parseTools('```zetta:artifact\n{"title":"Odd","content":"x","format":"html"}\n```').rejected,
    ).toEqual([{ kind: "artifact", title: "Odd", reason: 'Unrecognized key: "format"' }]);
    expect(parseTools('```zetta:artifact\n{"title":"None"}\n```').rejected).toEqual([
      { kind: "artifact", title: "None", reason: "give exactly one of path or content" },
    ]);
    expect(parseTools("```zetta:artifact\n{not json\n```").rejected).toEqual([
      { kind: "artifact", reason: "the block is not valid JSON" },
    ]);
    const nine = Array.from(
      { length: 9 },
      (_, i) => `\`\`\`zetta:artifact\n{"title":"A${i}","content":"x"}\n\`\`\``,
    ).join("\n");
    const r = parseTools(nine);
    expect(r.calls).toHaveLength(8);
    expect(r.rejected).toEqual([
      {
        kind: "artifact",
        title: "A8",
        reason: "over the 8-block limit for one reply; send it in your next reply",
      },
    ]);
  });
  test("zetta:memory is the memory tool; zetta:wiki still works as its old name", () => {
    const call = '{"action":"search","query":"tea"}';
    expect(parseTools("```zetta:memory\n" + call + "\n```").calls).toHaveLength(1);
    expect(parseTools("```zetta:wiki\n" + call + "\n```").calls).toHaveLength(1);
    // A refused block is reported under the new name, also when the bot used the old one.
    expect(parseTools("```zetta:wiki\nnot json\n```").rejected).toEqual([
      { kind: "memory", reason: "the block is not valid JSON" },
    ]);
  });
  test("memory accepts the graph fields and never lets a bot publish", () => {
    const memory = (json: string) => parseTools("```zetta:memory\n" + json + "\n```").calls;
    expect(
      memory(
        '{"action":"write","slug":"close-month","title":"Close the month","content":"1. pull 2. sum","howto":"month end","tags":["instruction"],"type":"teams","teams":["0192f5a0-7b1c-7000-8000-000000000001"],"score":80}',
      ),
    ).toHaveLength(1);
    expect(memory('{"action":"links","slug":"close-month","depth":2}')).toHaveLength(1);
    expect(memory('{"action":"archive","slug":"close-month"}')).toHaveLength(1);
    // `all` publishes to every member: only a person does that. Out-of-range score, depth and old field names are refused.
    expect(
      memory('{"action":"write","slug":"a","title":"A","content":"x","type":"all"}'),
    ).toHaveLength(0);
    expect(
      memory('{"action":"write","slug":"a","title":"A","content":"x","score":101}'),
    ).toHaveLength(0);
    expect(memory('{"action":"links","slug":"a","depth":3}')).toHaveLength(0);
    expect(memory('{"action":"write","slug":"a","title":"A","body":"x"}')).toHaveLength(0);
  });
  test("the old instruction block is not a tool any more", () => {
    expect(
      parseTools('```zetta:instruction\n{"title":"Report","body":"1. pull 2. sum"}\n```').calls,
    ).toHaveLength(0);
  });
});

describe("rich answers", () => {
  test("every bot is taught the zetta:ui block, and it is not parsed as a tool", () => {
    expect(toolPreamble("off")).toContain("```zetta:ui");
    expect(toolPreamble("desktop", true)).toContain("- Table ");
    expect(toolPreamble("off").endsWith("Only use a tool when it is needed.")).toBe(true);
    const reply = 'See:\n```zetta:ui\n{"op":"add","path":"/root","value":"a"}\n```';
    expect(parseTools(reply)).toEqual({ calls: [], text: reply, rejected: [] });
  });
});

describe("chief creation tools", () => {
  test("only the chief is told to create bots and teams itself", () => {
    expect(toolPreamble("off", false, true)).toContain("zetta:create_team");
    expect(toolPreamble("off", false, true)).toContain("zetta:create_bot");
    expect(toolPreamble("off")).not.toContain("zetta:create_team");
  });
  test("only the chief is told about add_to_team", () => {
    expect(toolPreamble("off", false, true)).toContain("zetta:add_to_team");
    expect(toolPreamble("off")).not.toContain("zetta:add_to_team");
  });
  test("add_to_team needs a team and at least one member", () => {
    expect(
      parseTools('```zetta:add_to_team\n{"team":"devs","members":[{"bot":"Coder"}]}\n```').calls,
    ).toEqual([
      { kind: "add_to_team", args: { team: "devs", members: [{ bot: "Coder", role: "" }] } },
    ]);
    expect(parseTools('```zetta:add_to_team\n{"team":"devs","members":[]}\n```').calls).toEqual([]);
  });
  test("the chief's prompt carries the manager playbook, and it stays short", () => {
    const chief = toolPreamble("off", false, true);
    for (const needed of ["zetta:next_wave", "open_room", "Ask at most 3 short questions"])
      expect(chief).toContain(needed);
    expect(chief).not.toContain("asks for a new bot or a team, create it yourself");
    // A playbook that grows creeps into every Chief turn: raise this limit on purpose, not by accident.
    // Raised from 30_000 to 30_500 on purpose: the memory-as-database guidance (list, append, ~600 characters) is read by every bot.
    // Raised from 30_500 to 31_100 on purpose: task plans and follow-up (subtasks, progress, checkAt, ~650 characters) are read by every bot.
    expect(chief.length).toBeLessThan(31_100);
    expect(toolPreamble("off", false, false)).not.toContain("next_wave");
  });
  test("create_team defaults to no goal, no context and no members", () => {
    expect(parseTools('```zetta:create_team\n{"name":"Launch"}\n```').calls).toEqual([
      { kind: "create_team", args: { name: "Launch", goal: "", context: "", members: [] } },
    ]);
  });
});

describe("zetta:memory as the bots' database", () => {
  const fence = (body: string) => "```zetta:memory\n" + body + "\n```";
  const parse = (body: string) => parseTools(fence(body));

  test("every bot is told to keep lists and records in memory, with list and append", () => {
    const text = toolPreamble("off");
    expect(text).toContain("as your database");
    expect(text).toContain('{"action":"list","tags":["list"]}');
    expect(text).toContain('{"action":"append","slug","content"');
    expect(text).toContain("under 15000 characters");
  });

  test("list and append are valid calls; unknown fields and out-of-range values are not", () => {
    expect(
      parse('{"action":"list","tags":["list"],"tagMode":"all","type":"solo","days":7,"limit":10}')
        .calls,
    ).toHaveLength(1);
    expect(parse('{"action":"list"}').calls).toHaveLength(1);
    expect(
      parse('{"action":"append","slug":"choquei-sources","content":"https://example.invalid/feed"}')
        .calls,
    ).toHaveLength(1);
    for (const bad of [
      '{"action":"list","type":"all"}',
      '{"action":"list","limit":51}',
      '{"action":"list","days":0}',
      '{"action":"list","query":"words"}',
      '{"action":"append","slug":"x"}',
      '{"action":"append","slug":"x","content":""}',
      `{"action":"append","slug":"x","content":"${"y".repeat(8001)}"}`,
    ])
      expect(parse(bad).calls).toEqual([]);
  });
});
