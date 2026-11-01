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
  test("every bot is told to pick the method itself", () => {
    expect(toolPreamble("off")).toContain("Never ask the user to choose a method");
    expect(toolPreamble("desktop", true, true)).toContain("Pick it yourself");
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
    const remember = '```zetta:remember\n{"content":"x"}\n```\n';
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
  test("instruction accepts the old create form and a read by id, and nothing else", () => {
    expect(
      parseTools('```zetta:instruction\n{"title":"Report","body":"1. pull 2. sum"}\n```').calls,
    ).toHaveLength(1);
    expect(
      parseTools(
        '```zetta:instruction\n{"action":"read","id":"0192f5a0-7b1c-7000-8000-000000000001"}\n```',
      ).calls,
    ).toHaveLength(1);
    expect(
      parseTools('```zetta:instruction\n{"action":"read","id":"not-a-uuid"}\n```').calls,
    ).toHaveLength(0);
    expect(
      parseTools(
        '```zetta:instruction\n{"action":"read","id":"0192f5a0-7b1c-7000-8000-000000000001","body":"x"}\n```',
      ).calls,
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
  test("create_team defaults to no goal and no members", () => {
    expect(parseTools('```zetta:create_team\n{"name":"Launch"}\n```').calls).toEqual([
      { kind: "create_team", args: { name: "Launch", goal: "", members: [] } },
    ]);
  });
});
