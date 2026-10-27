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
  test("code access is only described when the owner enabled it", () => {
    expect(toolPreamble("off")).not.toContain("Code access");
    expect(toolPreamble("off", true)).toContain("git clone");
    expect(toolPreamble("browser", true)).toContain("zetta:browser");
    expect(toolPreamble("browser", true)).toContain("Code access");
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
});

describe("rich answers", () => {
  test("every bot is taught the zetta:ui block, and it is not parsed as a tool", () => {
    expect(toolPreamble("off")).toContain("```zetta:ui");
    expect(toolPreamble("desktop", true)).toContain("- Table ");
    expect(toolPreamble("off").endsWith("Only use a tool when it is needed.")).toBe(true);
    const reply = 'See:\n```zetta:ui\n{"op":"add","path":"/root","value":"a"}\n```';
    expect(parseTools(reply)).toEqual({ calls: [], text: reply });
  });
});
