/** What a run reports while it works, next to the reply text. `activity` is a short line for the chat's status and timeline. */
export type CliProgress = {
  activity: string;
  /** A Bash step only: the tool call's id. The chat uses it to open the live output of that command. */
  stepId?: string;
};
/** What the parser reports for a Bash step: `command` is the raw text, only to match the step to its output file; it never leaves the server. */
export type ClaudeActivity = CliProgress & { command?: string };
/** The tool result of a Bash step arrived: the command is done. */
export type ClaudeStepDone = { stepDone: string };
/** Live input only: the bot took the message written to it with this `uuid` (the CLI replays the line when the model reads it). */
export type ClaudeRead = { read: string };
/** Live input only: a point where the run can take another message: a tool call ended, or the bot finished an answer. */
export type ClaudeBoundary = { boundary: "tool" | "answer" };
export type ClaudeItem = string | ClaudeActivity | ClaudeStepDone | ClaudeRead | ClaudeBoundary;
/** Token counts of a run, as Claude Code reports them in its `result` event. Counts only: no text. */
export type TokenUsage = { input: number; cacheRead: number; cacheWrite: number; output: number };
export const noUsage = (): TokenUsage => ({ input: 0, cacheRead: 0, cacheWrite: 0, output: 0 });
export const addUsage = (to: TokenUsage, u: TokenUsage) => {
  to.input += u.input;
  to.cacheRead += u.cacheRead;
  to.cacheWrite += u.cacheWrite;
  to.output += u.output;
};

// A line is an event only when it has one of these types; any other line (even valid JSON) is plain reply text if the run has no result.
const EVENT_TYPES = new Set(["system", "assistant", "user", "result", "stream_event"]);
const LINE_MAX = 1_048_576; // a verbose tool result can be huge; a line past this is dropped, not buffered
const NOTE_MAX = 140;
const ARG_MAX = 60;

/**
 * Live input only: what the bot answers at once to a message it took while working, when that message is a separate quick question.
 * The body goes into the reply as soon as it is written, while the bot carries on (see `CLAUDE_LIVE_NOTE` in harness.ts).
 */
const SAY_BLOCK = /```zetta:say[ \t]*\r?\n([\s\S]*?)\r?\n?```/g;

const asObj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" ? (v as Record<string, unknown>) : {};
const str = (v: unknown) => (typeof v === "string" ? v.trim() : "");
const clip = (s: string, n: number) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);
const base = (p: string) => p.split(/[\\/]/).filter(Boolean).at(-1) ?? p;
const host = (u: string) => {
  try {
    return new URL(u).hostname;
  } catch {
    return "";
  }
};

/**
 * One line for a tool call. It never shows a raw command or a URL path: those can hold a token. A Bash call shows its own
 * description, or only the program name.
 */
export function toolLabel(name: string, input: unknown): string {
  const i = asObj(input);
  switch (name) {
    case "Bash": {
      const d = str(i.description);
      if (d) return clip(d, NOTE_MAX);
      const program = str(i.command).split(/\s+/)[0] ?? "";
      return program ? `Running ${clip(base(program), ARG_MAX)}` : "Running a command";
    }
    case "Read":
      return `Reading ${base(str(i.file_path)) || "a file"}`;
    case "Edit":
    case "NotebookEdit":
      return `Editing ${base(str(i.file_path) || str(i.notebook_path)) || "a file"}`;
    case "Write":
      return `Writing ${base(str(i.file_path)) || "a file"}`;
    case "Grep":
    case "Glob":
      return `Searching "${clip(str(i.pattern), ARG_MAX)}"`;
    case "WebSearch":
      return `Searching the web: ${clip(str(i.query), ARG_MAX)}`;
    case "WebFetch":
      return `Reading ${host(str(i.url)) || "a web page"}`;
    case "Task":
    case "Agent":
      return `Sub-agent: ${clip(str(i.description) || "working", ARG_MAX)}`;
    case "Skill":
      return `Using skill ${clip(str(i.skill) || str(i.name), ARG_MAX)}`.trim();
    case "TodoWrite": {
      const todos = Array.isArray(i.todos) ? i.todos.map(asObj) : [];
      const now = todos.find((t) => t.status === "in_progress");
      return str(now?.activeForm) || "Updating the plan";
    }
    default: {
      // mcp__server__tool -> "mcp server.tool", which the web shows as "Running server · tool".
      const m = name.match(/^mcp__(.+?)__(.+)$/);
      return m ? `mcp ${m[1]}.${m[2]}` : name;
    }
  }
}

/**
 * Reads Claude Code's `--output-format stream-json --verbose` output line by line. `push` takes raw text and returns what is new:
 * activity lines (a tool call, a note the bot wrote before it, "Thinking") and, when the run ends, the reply as a string.
 *
 * The reply is the `result` line, which is the same text plain `-p` printed. Text the bot writes before a tool call is a note, not
 * the answer: it is sent only when a tool call follows. A run that printed no events (an old CLI, a start-up error) keeps its plain
 * text as the reply. Unknown event types are ignored, so a newer CLI loses labels but never the answer.
 */
export function createClaudeStream(opts: { live?: boolean } = {}) {
  let buf = "";
  let skipping = false;
  let note = "";
  let answered = false;
  const plain: string[] = [];
  const out: ClaudeItem[] = [];
  const state: {
    failed: boolean;
    errorText: string;
    lastActivity: string;
    /** The run started a tool call or finished an answer: from here on, starting it again would throw work away. */
    worked: boolean;
    usage?: TokenUsage;
  } = {
    failed: false,
    errorText: "",
    lastActivity: "",
    worked: false,
  };

  const bashSteps = new Set<string>();
  // Reply text already sent on: a later piece starts after a blank line.
  let wrote = false;
  const text = (piece: string) => {
    if (!piece.trim()) return;
    out.push(wrote ? `\n\n${piece}` : piece);
    wrote = true;
  };
  /** Sends on what the bot said in `zetta:say` blocks and returns the text without them. */
  const withoutSay = (raw: string, send: boolean) =>
    opts.live
      ? raw
          .replace(SAY_BLOCK, (_all, body: string) => {
            if (send) text(body.trim());
            return "";
          })
          .trim()
      : raw;
  const activity = (label: string, step?: { id: string; command: string }) => {
    if (!label) return;
    if (label !== "Thinking") state.lastActivity = label;
    out.push(
      step ? { activity: label, stepId: step.id, command: step.command } : { activity: label },
    );
  };

  const handle = (line: string) => {
    let ev: Record<string, unknown> = {};
    try {
      ev = asObj(JSON.parse(line));
    } catch {
      /* not JSON: plain text */
    }
    if (typeof ev.type !== "string" || !EVENT_TYPES.has(ev.type)) {
      // With live input the CLI prints more kinds of lines (`command_lifecycle`, `rate_limit_event`): a JSON line with a type it
      // does not know is never reply text there.
      if (!opts.live || typeof ev.type !== "string") plain.push(line);
      return;
    }
    if (ev.type === "assistant") {
      const content = asObj(ev.message).content;
      for (const part of Array.isArray(content) ? content.map(asObj) : []) {
        if (part.type === "text") note = withoutSay(str(part.text), true) || note;
        else if (part.type === "thinking") activity("Thinking");
        else if (part.type === "tool_use") {
          state.worked = true;
          if (note) activity(clip(note.split("\n")[0]!.trim(), NOTE_MAX));
          note = "";
          const id = str(part.id);
          const command = str(asObj(part.input).command);
          const bash = str(part.name) === "Bash" && id && command;
          if (bash) bashSteps.add(id);
          activity(toolLabel(str(part.name), part.input), bash ? { id, command } : undefined);
        }
      }
    } else if (ev.type === "user") {
      // A message written to the run comes back when the bot takes it (`--replay-user-messages`): that is its read receipt.
      if (ev.isReplay === true) {
        if (opts.live && str(ev.uuid)) out.push({ read: str(ev.uuid) });
        return;
      }
      const content = asObj(ev.message).content;
      let toolEnded = false;
      for (const part of Array.isArray(content) ? content.map(asObj) : []) {
        const id = str(part.tool_use_id);
        if (part.type === "tool_result") toolEnded = true;
        if (part.type === "tool_result" && bashSteps.delete(id)) out.push({ stepDone: id });
      }
      if (opts.live && toolEnded) out.push({ boundary: "tool" });
    } else if (ev.type === "result") {
      state.worked = true;
      const usage = asObj(ev.usage);
      const count = (v: unknown) =>
        typeof v === "number" && Number.isFinite(v) && v > 0 ? Math.round(v) : 0;
      // A run that takes messages while it works answers more than once, and each result counts its own turn only.
      state.usage ??= noUsage();
      addUsage(state.usage, {
        input: count(usage.input_tokens),
        cacheRead: count(usage.cache_read_input_tokens),
        cacheWrite: count(usage.cache_creation_input_tokens),
        output: count(usage.output_tokens),
      });
      const result = typeof ev.result === "string" ? ev.result : "";
      if (ev.is_error === true || (ev.subtype !== undefined && ev.subtype !== "success")) {
        state.failed = true;
        state.errorText = result;
      } else text(withoutSay(result, false));
      answered = true;
      note = "";
      if (opts.live) out.push({ boundary: "answer" });
    }
  };

  const take = () => out.splice(0, out.length);
  return {
    state,
    /** New items from a chunk of stdout. */
    push(chunk: string): ClaudeItem[] {
      buf += chunk;
      for (let at = buf.indexOf("\n"); at !== -1; at = buf.indexOf("\n")) {
        const line = buf.slice(0, at);
        buf = buf.slice(at + 1);
        if (skipping) skipping = false;
        else if (line.length <= LINE_MAX) handle(line);
      }
      if (buf.length > LINE_MAX) {
        buf = "";
        skipping = true;
      }
      return take();
    },
    /** The end of stdout: the last line may have had no newline, and a run with no result keeps its plain text. */
    end(): ClaudeItem[] {
      if (buf && !skipping) handle(buf);
      buf = "";
      if (!answered && !state.failed && plain.length) out.push(plain.map((l) => `${l}\n`).join(""));
      return take();
    },
  };
}
