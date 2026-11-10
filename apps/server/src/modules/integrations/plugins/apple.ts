import { assertLocal } from "./local-only";
import { PluginError, registerPlugin, type PluginDef } from "./registry";
import { optStr, str } from "./rest";

/**
 * The Apple apps on the Mac Zetta runs on: Notes, Reminders, Calendar, Contacts and Shortcuts, through `osascript` and `shortcuts`.
 * Values travel as arguments (`on run argv`), never spliced into the script, so text cannot inject AppleScript. macOS asks the person
 * once per app to allow automation. Local installs on macOS only; nothing is sent or deleted.
 */
type Exec = (
  cmd: string[],
  timeoutMs: number,
) => Promise<{ code: number; stdout: string; stderr: string; timedOut?: boolean }>;
let exec: Exec = async (cmd, timeoutMs) => {
  const p = Bun.spawn(cmd, { stdout: "pipe", stderr: "pipe", stdin: "ignore" });
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    p.kill();
  }, timeoutMs);
  const [stdout, stderr] = await Promise.all([
    new Response(p.stdout).text(),
    new Response(p.stderr).text(),
  ]);
  const code = await p.exited;
  clearTimeout(timer);
  return { code, stdout, stderr, timedOut };
};
/** Tests replace the process runner. */
export const setAppleExec = (e: Exec) => {
  exec = e;
};

const SEP = "\u001f";

async function script(source: string, args: string[], app: string) {
  assertLocal("Apple apps", "darwin");
  const r = await exec(["osascript", "-e", source, "--", ...args], 30_000);
  if (r.code !== 0) {
    // The first call to an app shows macOS's "allow Zetta to control …" prompt and waits for the person: a cut-off call is that wait.
    if (r.timedOut && !r.stderr.trim())
      throw new PluginError(
        "NEEDS_AUTH",
        `${app} did not answer in time: macOS is probably asking you to allow Zetta to control ${app}.`,
        "Click Allow on the macOS prompt (or System Settings > Privacy & Security > Automation), then try again.",
      );
    if (/not allowed|not authori[sz]ed|-1743/i.test(r.stderr))
      throw new PluginError(
        "NEEDS_AUTH",
        `macOS did not allow Zetta to use ${app}.`,
        `Open System Settings > Privacy & Security > Automation and allow the app that runs Zetta to control ${app}.`,
      );
    throw new PluginError(
      "APP_ERROR",
      `${app} could not do that: ${r.stderr.trim().slice(0, 200)}`,
    );
  }
  return r.stdout.replace(/\n$/, "");
}
const rows = (out: string, keys: string[]) =>
  out
    ? out
        .split("\n")
        .map((line) => Object.fromEntries(line.split(SEP).map((v, i) => [keys[i] ?? `f${i}`, v])))
    : [];

const DAYS = (v: unknown) => (typeof v === "number" && v >= 1 && v <= 31 ? Math.floor(v) : 7);

export const applePlugin: PluginDef = registerPlugin({
  id: "apple",
  name: "Apple apps",
  description:
    "Notes, Reminders, Calendar, Contacts and Shortcuts on your Mac (when Zetta runs on it).",
  icon: "apple-logo",
  category: "productivity",
  auth: "none",
  fields: [],
  guide: () => [
    "This works when Zetta runs on your Mac.",
    "The first time a bot uses an app, macOS asks to allow it: click Allow (or later in System Settings > Privacy & Security > Automation).",
  ],
  kind: "native",
  async install() {
    assertLocal("Apple apps", "darwin");
  },
  tools: [
    {
      name: "notes_search",
      description: "Find notes in Notes whose name or text contains the words.",
      effect: "read",
      inputSchema: {
        type: "object",
        properties: { query: { type: "string" } },
        required: ["query"],
      },
      handler: async (_c, a) =>
        rows(
          await script(
            `on run argv
set q to item 1 of argv
set out to {}
tell application "Notes"
  repeat with n in (notes whose name contains q or plaintext contains q)
    set end of out to (name of n) & "${SEP}" & (text 1 thru (min(200, length of (plaintext of n))) of (plaintext of n))
    if (count of out) ≥ 20 then exit repeat
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
end run
on min(a, b)
  if a < b then return a
  return b
end min`,
            [str(a, "query", 200)],
            "Notes",
          ),
          ["name", "start"],
        ),
    },
    {
      name: "notes_create",
      description: "Create a note in Notes (HTML or plain text body).",
      inputSchema: {
        type: "object",
        properties: { title: { type: "string" }, body: { type: "string" } },
        required: ["title", "body"],
      },
      handler: async (_c, a) => {
        await script(
          `on run argv
tell application "Notes" to make new note with properties {name:item 1 of argv, body:item 2 of argv}
end run`,
          [str(a, "title", 200), str(a, "body", 50_000)],
          "Notes",
        );
        return "note created";
      },
    },
    {
      name: "reminders_list",
      description: "Open reminders, optionally of one list.",
      effect: "read",
      inputSchema: { type: "object", properties: { list: { type: "string" } } },
      handler: async (_c, a) =>
        rows(
          await script(
            `on run argv
set out to {}
tell application "Reminders"
  if (count of argv) > 0 and item 1 of argv is not "" then
    set rs to (reminders of list (item 1 of argv) whose completed is false)
  else
    set rs to (reminders whose completed is false)
  end if
  repeat with r in rs
    set d to ""
    try
      set d to (due date of r) as «class isot» as string
    end try
    set end of out to (name of r) & "${SEP}" & d
    if (count of out) ≥ 50 then exit repeat
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
end run`,
            [optStr(a, "list", 100) ?? ""],
            "Reminders",
          ),
          ["name", "due"],
        ),
    },
    {
      name: "reminders_add",
      description:
        "Add a reminder, optionally to a list and with a due date (ISO, e.g. 2026-11-12T09:00).",
      inputSchema: {
        type: "object",
        properties: {
          title: { type: "string" },
          list: { type: "string" },
          due: { type: "string" },
        },
        required: ["title"],
      },
      handler: async (_c, a) => {
        const due = optStr(a, "due", 40);
        if (due && Number.isNaN(Date.parse(due)))
          throw new PluginError("INVALID_ARGS", "due is not a date.");
        await script(
          `on run argv
set t to item 1 of argv
set l to item 2 of argv
set d to item 3 of argv
tell application "Reminders"
  if l is "" then
    set target to default list
  else
    set target to list l
  end if
  set r to make new reminder at end of reminders of target with properties {name:t}
  if d is not "" then
    set due date of r to (current date) + ((d as number) - (do shell script "date +%s") as number)
  end if
end tell
end run`,
          [
            str(a, "title", 300),
            optStr(a, "list", 100) ?? "",
            due ? String(Math.floor(Date.parse(due) / 1000)) : "",
          ],
          "Reminders",
        );
        return "reminder added";
      },
    },
    {
      name: "calendar_events",
      description: "Events in the next days (default 7) across your calendars.",
      effect: "read",
      inputSchema: { type: "object", properties: { days: { type: "number" } } },
      handler: async (_c, a) =>
        rows(
          await script(
            `on run argv
set n to (item 1 of argv) as number
set s to current date
set e to s + n * days
set out to {}
tell application "Calendar"
  repeat with c in calendars
    repeat with ev in (events of c whose start date ≥ s and start date ≤ e)
      set end of out to (summary of ev) & "${SEP}" & ((start date of ev) as «class isot» as string) & "${SEP}" & (name of c)
    end repeat
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
end run`,
            [String(DAYS(a.days))],
            "Calendar",
          ),
          ["title", "start", "calendar"],
        ).slice(0, 100),
    },
    {
      name: "contacts_find",
      description: "Find people in Contacts by name: emails and phones.",
      effect: "read",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      handler: async (_c, a) =>
        rows(
          await script(
            `on run argv
set out to {}
tell application "Contacts"
  repeat with p in (people whose name contains (item 1 of argv))
    set em to ""
    set ph to ""
    try
      set em to value of first email of p
    end try
    try
      set ph to value of first phone of p
    end try
    set end of out to (name of p) & "${SEP}" & em & "${SEP}" & ph
    if (count of out) ≥ 10 then exit repeat
  end repeat
end tell
set AppleScript's text item delimiters to linefeed
return out as text
end run`,
            [str(a, "name", 100)],
            "Contacts",
          ),
          ["name", "email", "phone"],
        ),
    },
    {
      name: "shortcuts_run",
      description: "Run one of your Shortcuts by name. Returns its output.",
      inputSchema: { type: "object", properties: { name: { type: "string" } }, required: ["name"] },
      handler: async (_c, a) => {
        assertLocal("Apple apps", "darwin");
        const r = await exec(["shortcuts", "run", str(a, "name", 200)], 120_000);
        if (r.code !== 0)
          throw new PluginError(
            "APP_ERROR",
            `The shortcut could not run: ${r.stderr.trim().slice(0, 200)}`,
          );
        return r.stdout.slice(0, 8000) || "done";
      },
    },
  ],
});
