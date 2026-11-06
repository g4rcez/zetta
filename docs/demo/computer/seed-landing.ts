// Fake data for the landing page recordings (record.ts routines | memory | inbox | tasks | chats). Run once after stack.sh up:
//
//   bun docs/demo/computer/seed-landing.ts
//
// It uses the app's own HTTP API as the signed-in demo user (state.json from seed.ts): four bots with the page's cast and avatars, three
// routines, the notes a person would keep in memory, the task board, and the two Inbox items of the page. The only direct database write
// is who owns each task: the API creates a task for the person, and a bot owns one when it adds it from a chat, so the demo sets bot_id
// after the fact (same rows, same screens). Nothing here is real: emails are @example.invalid, no secrets.
import { spawnSync } from "node:child_process";
import { DEMO, ORIGIN, STATE, browserOptions, loadChromium } from "./lib.ts";
import { join } from "node:path";

const browser = await (await loadChromium()).launch();
const context = await browser.newContext({ ...browserOptions, storageState: STATE });
const page = await context.newPage();
await page.goto(`${ORIGIN}/chat`);

const api = <T = any>(method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([method, path, body]) => {
      const res = await fetch(`/api${path}`, {
        method,
        credentials: "include",
        headers: { "content-type": "application/json" },
        // oxlint-disable-next-line unicorn/no-invalid-fetch-options -- `method` is a variable here, not always GET
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: (await res.json().catch(() => null)) as any };
    },
    [method, path, body] as const,
  ) as Promise<{ status: number; json: T }>;
const must = async <T>(what: string, call: Promise<{ status: number; json: T }>) => {
  const r = await call;
  if (r.status >= 300) throw new Error(`${what} failed: ${r.status} ${JSON.stringify(r.json)}`);
  return r.json;
};

// The cast of the landing page (apps/landing/src/cast.ts): same characters, same default colors.
const CAST = [
  {
    name: "Writer",
    art: { preset: "cat", colors: ["#c7d2fe", "#f59e0b", "#fef3c7"] },
    description: "Drafts the newsletter and the posts, in short sentences.",
  },
  {
    name: "Reviewer",
    art: { preset: "owl", colors: ["#134e4a", "#a16207", "#fde047"] },
    description: "Reads pull requests and says what to fix first.",
  },
  {
    name: "Researcher",
    art: { preset: "rocket", colors: ["#0c1a3a", "#e5e7eb", "#f97316"] },
    description: "Reads the sources and writes the weekly brief.",
  },
  {
    name: "Editor",
    art: { preset: "ghost", colors: ["#1e1b4b", "#e0e7ff", "#f9a8d4"] },
    description: "Checks every draft before it goes out.",
  },
];
for (const c of CAST) {
  await must(
    `creating ${c.name}`,
    api("POST", "/bots", {
      name: c.name,
      description: c.description,
      // "You are Writer": how the stand-in `claude` (bin/claude) knows which bot is asking.
      personality: `You are ${c.name}. ${c.description}`,
      instructions:
        "Do the job well, say what you did, and ask before anything that cannot be undone.",
      visibility: "team",
      harness: "claude-code",
      codeAccess: true,
      avatar: { kind: "preset", ...c.art },
    }),
  );
}
const bots = (
  await must<{ bots: { id: string; name: string }[] }>("listing bots", api("GET", "/bots"))
).bots;
const id = (name: string) => {
  const b = bots.find((x) => x.name === name);
  if (!b) throw new Error(`${name} is missing`);
  return b.id;
};

// Routines: a briefing, a newsletter and a pull request queue.
for (const r of [
  {
    botId: id("Researcher"),
    title: "Morning briefing",
    prompt:
      "Read the sources on the list and write the morning briefing: three lines, newest first.",
    dailyAt: "08:00",
  },
  {
    botId: id("Writer"),
    title: "Friday newsletter",
    prompt: "Write the Friday newsletter from this week's updates. Ask before it is sent.",
    dailyAt: "15:00",
  },
  {
    botId: id("Reviewer"),
    title: "Pull request queue",
    prompt: "Review the open pull requests of the payments team first and list what needs a fix.",
    everyMinutes: 120,
  },
]) {
  await must(`creating ${r.title}`, api("POST", "/routines", { timezone: "UTC", ...r }));
}

// Memory: what a person tells their bots once and does not repeat.
for (const m of [
  {
    slug: "newsletter-style",
    title: "Newsletter style",
    howto: "Use when writing any newsletter.",
    content:
      "The newsletter goes out on Fridays, in short sentences. One link per item, no jargon.",
    tags: ["instruction", "newsletter"],
  },
  {
    slug: "payments-reviews-first",
    title: "Payments reviews first",
    howto: "Use when ordering the pull request queue.",
    content:
      "Pull requests from the payments team get reviewed first. Authentication changes come second.",
    tags: ["instruction", "reviews"],
  },
  {
    slug: "weekly-brief-scope",
    title: "Weekly brief scope",
    howto: "Use when writing the weekly brief.",
    content:
      "The weekly brief skips the marketing channel. It lists shipped, in progress and next week.",
    tags: ["instruction", "brief"],
  },
  {
    slug: "release-checklist",
    title: "Release checklist",
    howto: "Use before announcing a release.",
    content:
      "1. Tag the release.\n2. Write the notes.\n3. Ask the Editor to check them.\n4. Send the newsletter.",
    tags: ["instruction", "release"],
  },
]) {
  const { slug, ...rest } = m;
  await must(`writing ${slug}`, api("PUT", `/memory/${slug}`, { ...rest, expectedVersion: 0 }));
}

// The task board. `owner` is the bot that holds the card.
const TASKS = [
  { title: "Draft launch notes for 0.4", status: "backlog", priority: "medium", owner: "Writer" },
  {
    title: "Review the weekly pull request queue",
    status: "backlog",
    priority: "low",
    owner: "Reviewer",
  },
  {
    title: "Summarize merged pull requests for Monday",
    status: "in_progress",
    priority: "high",
    owner: "Researcher",
  },
  {
    title: "Collect sources on self-hosted agents",
    status: "in_progress",
    priority: "medium",
    owner: "Researcher",
  },
  {
    title: "Review the authentication pull request",
    status: "blocked",
    priority: "urgent",
    owner: "Reviewer",
  },
  { title: "Send the Friday newsletter", status: "review", priority: "high", owner: "Writer" },
  { title: "Publish the weekly brief", status: "done", priority: "none", owner: "Editor" },
] as const;
for (const t of TASKS)
  await must(
    `adding ${t.title}`,
    api("POST", "/tasks", { title: t.title, status: t.status, priority: t.priority }),
  );

// The Inbox: what a person is asked, as it looks when a bot raises it.
await must(
  "inbox 1",
  api("POST", "/attention", {
    botId: id("Writer"),
    title: "Send the newsletter to the whole team list?",
    detail: "Draft is ready and the links are checked. Sending mail waits for you.",
    nextAction: "Approve or decline",
  }),
);
await must(
  "inbox 2",
  api("POST", "/attention", {
    botId: id("Reviewer"),
    title: "Blocked: GitHub login expired",
    detail: "Reviewer cannot read the next files of the authentication pull request.",
    nextAction: "Sign in to GitHub again",
  }),
);
await browser.close();

// The computer demos' Operator is not part of the landing page's cast: it would show in the sidebar of every clip, so it is archived.
spawnSync(
  process.env.ZETTA_DEMO_ENGINE ?? "podman",
  [
    "exec",
    "-i",
    "zetta-demo-pg",
    "psql",
    "-U",
    "postgres",
    "-d",
    "zetta_demo",
    "-c",
    "update zetta.bot set archived = true where name = 'Operator'",
  ],
  { encoding: "utf8" },
);

// Who owns each task (see the note at the top).
const engine = process.env.ZETTA_DEMO_ENGINE ?? "podman";
const sql = TASKS.map(
  (t) =>
    `update zetta.task set bot_id = (select id from zetta.bot where name = '${t.owner}' limit 1) where title = '${t.title.replace(/'/g, "''")}';`,
).join("\n");
const psql = spawnSync(
  engine,
  [
    "exec",
    "-i",
    "zetta-demo-pg",
    "psql",
    "-U",
    "postgres",
    "-d",
    "zetta_demo",
    "-v",
    "ON_ERROR_STOP=1",
  ],
  { input: sql, encoding: "utf8" },
);
if (psql.status !== 0) throw new Error(`setting task owners failed: ${psql.stderr}`);
await Bun.write(
  join(DEMO, "landing.json"),
  JSON.stringify({ bots: Object.fromEntries(bots.map((b) => [b.name, b.id])) }),
);
console.log(
  `landing data seeded: ${CAST.length} bots, 3 routines, 4 memory items, ${TASKS.length} tasks, 2 inbox items`,
);
