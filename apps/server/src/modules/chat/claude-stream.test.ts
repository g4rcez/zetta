import { describe, expect, test } from "bun:test";
import { createClaudeStream, toolLabel } from "./claude-stream";

const line = (o: unknown) => `${JSON.stringify(o)}\n`;
const assistant = (...content: unknown[]) => line({ type: "assistant", message: { content } });

describe("claude stream-json", () => {
  test("a note before a tool call and the tool label are progress; the result is the reply", () => {
    const s = createClaudeStream();
    const items = [
      ...s.push(line({ type: "system", subtype: "init" })),
      ...s.push(
        assistant(
          { type: "text", text: "I will read the config first.\nThen the tests." },
          { type: "tool_use", name: "Read", input: { file_path: "/srv/app/config.ts" } },
        ),
      ),
      ...s.push(line({ type: "user", message: { content: [{ type: "tool_result" }] } })),
      ...s.push(assistant({ type: "text", text: "The config is fine." })),
      ...s.push(
        line({
          type: "result",
          subtype: "success",
          is_error: false,
          result: "The config is fine.",
        }),
      ),
      ...s.end(),
    ];
    expect(items).toEqual([
      { activity: "I will read the config first." },
      { activity: "Reading config.ts" },
      "The config is fine.",
    ]);
    expect(s.state.failed).toBe(false);
  });

  test("a line split across chunks is read once it is complete", () => {
    const s = createClaudeStream();
    const text = assistant({ type: "tool_use", name: "Grep", input: { pattern: "TODO" } });
    expect(s.push(text.slice(0, 20))).toEqual([]);
    expect(s.push(text.slice(20))).toEqual([{ activity: 'Searching "TODO"' }]);
  });

  test("a last line without a newline is still read", () => {
    const s = createClaudeStream();
    expect(
      s.push(
        JSON.stringify({ type: "result", subtype: "success", is_error: false, result: "Done" }),
      ),
    ).toEqual([]);
    expect(s.end()).toEqual(["Done"]);
  });

  test("thinking becomes the generic Thinking activity", () => {
    const s = createClaudeStream();
    expect(s.push(assistant({ type: "thinking", thinking: "hmm" }))).toEqual([
      { activity: "Thinking" },
    ]);
    expect(s.state.lastActivity).toBe("");
  });

  test("an error result sets failed and gives no reply text", () => {
    const s = createClaudeStream();
    const items = s.push(
      line({
        type: "result",
        subtype: "success",
        is_error: true,
        result: "Invalid API key · Please run /login",
      }),
    );
    expect(items).toEqual([]);
    expect(s.state.failed).toBe(true);
    expect(s.state.errorText).toBe("Invalid API key · Please run /login");
  });

  test("an error subtype without text also fails", () => {
    const s = createClaudeStream();
    s.push(line({ type: "result", subtype: "error_max_turns", is_error: true }));
    expect(s.state.failed).toBe(true);
  });

  test("lines that are not JSON do not reach the reply when a result exists", () => {
    const s = createClaudeStream();
    const items = [
      ...s.push("update available\n"),
      ...s.push(line({ type: "result", subtype: "success", is_error: false, result: "Hi" })),
      ...s.end(),
    ];
    expect(items).toEqual(["Hi"]);
  });

  test("a run that prints plain text keeps it as the reply", () => {
    const s = createClaudeStream();
    expect([...s.push("plain answer\n"), ...s.end()]).toEqual(["plain answer\n"]);
  });

  test("a plain reply that is itself JSON is kept as the reply", () => {
    const s = createClaudeStream();
    expect([...s.push('{"question":"Who reads the notes?"}\n'), ...s.end()]).toEqual([
      '{"question":"Who reads the notes?"}\n',
    ]);
  });

  test("unknown event types and unknown content are ignored", () => {
    const s = createClaudeStream();
    expect(
      s.push(line({ type: "stream_event" }) + assistant({ type: "image" }, { type: "other" })),
    ).toEqual([]);
  });

  test("a line over the limit is dropped and the next line is read", () => {
    const s = createClaudeStream();
    expect(s.push("x".repeat(1_100_000))).toEqual([]);
    expect(s.push("tail of the big line\n")).toEqual([]);
    expect(
      s.push(assistant({ type: "tool_use", name: "Glob", input: { pattern: "*.ts" } })),
    ).toEqual([{ activity: 'Searching "*.ts"' }]);
  });
});

describe("tool labels", () => {
  test("a Bash call without a description shows the program only", () => {
    expect(
      toolLabel("Bash", { command: "curl -H 'Authorization: Bearer sk-test-123' https://x" }),
    ).toBe("Running curl");
  });
  test("a Bash call with a description shows the description", () => {
    expect(toolLabel("Bash", { command: "bun test", description: "Run the tests" })).toBe(
      "Run the tests",
    );
  });
  test("a web fetch shows the host and not the path", () => {
    expect(toolLabel("WebFetch", { url: "https://example.invalid/a/b?token=sk-test-1" })).toBe(
      "Reading example.invalid",
    );
  });
  test("an MCP tool uses the form the web already formats", () => {
    expect(toolLabel("mcp__postgres__db_overview", {})).toBe("mcp postgres.db_overview");
  });
  test("a todo update shows the step in progress", () => {
    expect(
      toolLabel("TodoWrite", {
        todos: [
          { status: "completed", activeForm: "Reading" },
          { status: "in_progress", activeForm: "Running the tests" },
        ],
      }),
    ).toBe("Running the tests");
  });
  test("a sub-agent and a skill", () => {
    expect(toolLabel("Task", { description: "Find callers" })).toBe("Sub-agent: Find callers");
    expect(toolLabel("Skill", { skill: "verify" })).toBe("Using skill verify");
  });
  test("an unknown tool shows its name", () => {
    expect(toolLabel("Mystery", {})).toBe("Mystery");
  });
});
