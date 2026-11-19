import { describe, expect, test } from "bun:test";
import { addUsage, createClaudeStream, noUsage, toolLabel } from "./claude-stream";

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

  test("a Bash call carries its id and raw command for matching, and its result reports it done", () => {
    const s = createClaudeStream();
    const items = [
      ...s.push(
        assistant(
          { type: "tool_use", id: "toolu_1", name: "Bash", input: { command: "sed -i s/a/b/ x" } },
          { type: "tool_use", id: "toolu_2", name: "Read", input: { file_path: "/a/b.ts" } },
        ),
      ),
      ...s.push(
        line({
          type: "user",
          message: {
            content: [
              { type: "tool_result", tool_use_id: "toolu_1" },
              { type: "tool_result", tool_use_id: "toolu_2" },
            ],
          },
        }),
      ),
    ];
    expect(items).toEqual([
      { activity: "Running sed", stepId: "toolu_1", command: "sed -i s/a/b/ x" },
      { activity: "Reading b.ts" },
      { stepDone: "toolu_1" },
    ]);
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
    expect(toolLabel("mcp__notion__search", {})).toBe("mcp notion.search");
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

  test("the result event reports the token counts of the run", () => {
    const s = createClaudeStream();
    s.push(
      line({
        type: "result",
        subtype: "success",
        is_error: false,
        result: "Done.",
        usage: {
          input_tokens: 12,
          cache_read_input_tokens: 31000,
          cache_creation_input_tokens: 4500,
          output_tokens: 230,
        },
      }),
    );
    expect(s.state.usage).toEqual({ input: 12, cacheRead: 31000, cacheWrite: 4500, output: 230 });
  });

  test("a result with no usage field counts zero, and no result event leaves usage unset", () => {
    const s = createClaudeStream();
    expect(s.state.usage).toBeUndefined();
    s.push(line({ type: "result", subtype: "success", is_error: false, result: "Done." }));
    expect(s.state.usage).toEqual({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
  });

  test("the usage of several processes of one reply adds up", () => {
    const total = noUsage();
    addUsage(total, { input: 10, cacheRead: 100, cacheWrite: 5, output: 20 });
    addUsage(total, { input: 1, cacheRead: 200, cacheWrite: 0, output: 3 });
    expect(total).toEqual({ input: 11, cacheRead: 300, cacheWrite: 5, output: 23 });
  });

  describe("live input: the run takes messages while it works", () => {
    const result = (text: string, usage?: object) =>
      line({ type: "result", subtype: "success", is_error: false, result: text, usage });

    test("a message the bot took is reported by its uuid; the replay is never read as a tool result", () => {
      const s = createClaudeStream({ live: true });
      expect(
        s.push(
          line({
            type: "user",
            isReplay: true,
            uuid: "01a1f43a-8dd0-7694-83e5-741019672e1f",
            message: { role: "user", content: "use staging" },
          }),
        ),
      ).toEqual([{ read: "01a1f43a-8dd0-7694-83e5-741019672e1f" }]);
    });

    test("the end of a tool call and the end of an answer are points where another message can go in", () => {
      const s = createClaudeStream({ live: true });
      const items = [
        ...s.push(
          assistant({ type: "tool_use", id: "t1", name: "Bash", input: { command: "make" } }),
        ),
        ...s.push(
          line({
            type: "user",
            message: { content: [{ type: "tool_result", tool_use_id: "t1" }] },
          }),
        ),
        ...s.push(result("Built.")),
      ];
      expect(items).toEqual([
        { activity: "Running make", stepId: "t1", command: "make" },
        { stepDone: "t1" },
        { boundary: "tool" },
        "Built.",
        { boundary: "answer" },
      ]);
    });

    test("a second answer of the same run follows the first after a blank line, and the token counts add up", () => {
      const s = createClaudeStream({ live: true });
      const text = [
        ...s.push(result("Deployed to staging.", { input_tokens: 4, output_tokens: 10 })),
        ...s.push(result("The meeting is at 3.", { input_tokens: 2, output_tokens: 6 })),
        ...s.end(),
      ]
        .filter((i) => typeof i === "string")
        .join("");
      expect(text).toBe("Deployed to staging.\n\nThe meeting is at 3.");
      expect(s.state.usage).toEqual({ input: 6, cacheRead: 0, cacheWrite: 0, output: 16 });
    });

    test("lines of a kind the parser does not know are never the reply, even when the run prints no result", () => {
      const s = createClaudeStream({ live: true });
      const items = [
        ...s.push(line({ type: "command_lifecycle", state: "started" })),
        ...s.push(line({ type: "rate_limit_event", rate_limit_info: {} })),
        ...s.end(),
      ];
      expect(items).toEqual([]);
      // Text that is not JSON is still kept: a start-up error must not vanish.
      const plain = createClaudeStream({ live: true });
      expect([...plain.push("something went wrong\n"), ...plain.end()]).toEqual([
        "something went wrong\n",
      ]);
    });

    test("a quick answer in a zetta:say block is reply text at once; the work note and the final answer do not repeat it", () => {
      const s = createClaudeStream({ live: true });
      const items = [
        ...s.push(
          assistant(
            {
              type: "text",
              text: "```zetta:say\nThe meeting is at 3 pm.\n```\nNow the second build.",
            },
            { type: "tool_use", id: "t2", name: "Bash", input: { command: "make two" } },
          ),
        ),
        ...s.push(
          line({
            type: "result",
            subtype: "success",
            is_error: false,
            result: "```zetta:say\nThe meeting is at 3 pm.\n```\nBoth builds passed.",
          }),
        ),
      ];
      expect(items).toEqual([
        "The meeting is at 3 pm.",
        { activity: "Now the second build." },
        { activity: "Running make", stepId: "t2", command: "make two" },
        "\n\nBoth builds passed.",
        { boundary: "answer" },
      ]);
    });

    test("a reply that is only a zetta:say block is still an answer, and without live input the block is left as written", () => {
      const s = createClaudeStream({ live: true });
      expect(
        [
          ...s.push(assistant({ type: "text", text: "```zetta:say\nYes.\n```" })),
          ...s.push(
            line({
              type: "result",
              subtype: "success",
              is_error: false,
              result: "```zetta:say\nYes.\n```",
            }),
          ),
        ].filter((i) => typeof i === "string"),
      ).toEqual(["Yes."]);
      const plain = createClaudeStream();
      expect(
        plain.push(
          line({
            type: "result",
            subtype: "success",
            is_error: false,
            result: "```zetta:say\nYes.\n```",
          }),
        ),
      ).toEqual(["```zetta:say\nYes.\n```"]);
    });

    test("without live input nothing changes: no receipts, no boundaries", () => {
      const s = createClaudeStream();
      expect([
        ...s.push(line({ type: "user", isReplay: true, uuid: "u", message: { content: "x" } })),
        ...s.push(line({ type: "user", message: { content: [{ type: "tool_result" }] } })),
        ...s.push(result("Done.")),
      ]).toEqual(["Done."]);
    });
  });
});
