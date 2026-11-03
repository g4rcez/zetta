/** What a run reports while it works, next to the reply text. `activity` is a short line for the chat's status and timeline. */
export type CliProgress = { activity: string };
export type ClaudeItem = string | CliProgress;

// A line is an event only when it has one of these types; any other line (even valid JSON) is plain reply text if the run has no result.
const EVENT_TYPES = new Set(["system", "assistant", "user", "result", "stream_event"]);
const LINE_MAX = 1_048_576; // a verbose tool result can be huge; a line past this is dropped, not buffered
const NOTE_MAX = 140;
const ARG_MAX = 60;

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
export function createClaudeStream() {
  let buf = "";
  let skipping = false;
  let note = "";
  let answered = false;
  const plain: string[] = [];
  const out: ClaudeItem[] = [];
  const state = { failed: false, errorText: "", lastActivity: "" };

  const activity = (label: string) => {
    if (!label) return;
    if (label !== "Thinking") state.lastActivity = label;
    out.push({ activity: label });
  };

  const handle = (line: string) => {
    let ev: Record<string, unknown> = {};
    try {
      ev = asObj(JSON.parse(line));
    } catch {
      /* not JSON: plain text */
    }
    if (typeof ev.type !== "string" || !EVENT_TYPES.has(ev.type)) {
      plain.push(line);
      return;
    }
    if (ev.type === "assistant") {
      const content = asObj(ev.message).content;
      for (const part of Array.isArray(content) ? content.map(asObj) : []) {
        if (part.type === "text") note = str(part.text) || note;
        else if (part.type === "thinking") activity("Thinking");
        else if (part.type === "tool_use") {
          if (note) activity(clip(note.split("\n")[0]!.trim(), NOTE_MAX));
          note = "";
          activity(toolLabel(str(part.name), part.input));
        }
      }
    } else if (ev.type === "result") {
      answered = true;
      const result = typeof ev.result === "string" ? ev.result : "";
      if (ev.is_error === true || (ev.subtype !== undefined && ev.subtype !== "success")) {
        state.failed = true;
        state.errorText = result;
      } else if (result.trim()) out.push(result);
      note = "";
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
