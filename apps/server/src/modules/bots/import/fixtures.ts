import type { BotImportDraft } from "./draft";
import type { GrokBot } from "./grok-source";

/** Invented marketplace bot for tests: fake names, no text from a real listing. */
export const grokBotFixture = (over: Partial<GrokBot> = {}): GrokBot => ({
  id: "example-bot",
  name: "Example Bot",
  creatorName: "Example Creator",
  handle: "example",
  description: "Checks a list of things every morning and says what changed.",
  summary: "Checks a list of things every morning.",
  categories: ["Operations"],
  installCount: 0,
  color: "blue",
  shape: "circle",
  addHref: "/bot/example-add-link",
  imageUrl: null,
  updatedAt: "2026-01-01T00:00:00.000Z",
  instructions: "",
  memories: [
    {
      id: "memory-0",
      name: "memory 1",
      description: "The list lives in the shared sheet called Things.",
    },
    { id: "memory-1", name: "memory 2", description: "Stay quiet when nothing changed." },
  ],
  skills: [
    {
      id: "skill-0",
      name: "Check the list",
      description: "Use this when asked to check the list.",
      content: "Use this when asked to check the list.",
    },
    {
      id: "skill-1",
      name: "Weekly summary",
      description: "Use this for the Monday summary.",
      content: "Use this for the Monday summary.",
    },
  ],
  routines: [
    {
      id: "routine-0",
      name: "morning-check",
      summary: "Cron 44 8 * * 1-5 (weekdays 8:44 local). Checks the list.",
    },
    {
      id: "routine-1",
      name: "weekly-summary",
      summary: "Cron 49 8 * * 1 (Mondays 8:49 local). Sends the summary.",
    },
  ],
  integrations: [
    { id: "integration-0", name: "Google Calendar", description: "Reads events." },
    { id: "integration-1", name: "Ramp", description: "Reads card spend." },
  ],
  ...over,
});

/** A valid draft as `analyze` would produce it for `grokBotFixture`. */
export const draftFixture = (over: Partial<BotImportDraft> = {}): BotImportDraft => ({
  source: {
    url: "https://x.ai/bot/marketplace/bots/example-bot",
    slug: "example-bot",
    creator: "Example Creator",
    handle: "example",
  },
  name: "Example Bot",
  description: "Checks a list of things every morning and says what changed.",
  avatar: { kind: "preset", preset: "circle", colors: ["#4a80e6"] },
  personality: "Brief and calm.",
  instructions: "Check the list, say what changed, stay quiet when nothing did.",
  timezone: "America/Sao_Paulo",
  skills: [
    {
      sourceId: "skill-0",
      name: "check-the-list",
      description: "Use this when asked to check the list.",
      body: "# Check the list\n\n1. Open the shared sheet called Things.\n2. Compare it with the last check.\n3. Report only what changed.",
      warnings: [],
    },
    {
      sourceId: "skill-1",
      name: "weekly-summary",
      description: "Use this for the Monday summary.",
      body: "# Weekly summary\n\nCollect the week's changes and write five lines.",
      warnings: [],
    },
  ],
  notes: [
    {
      sourceId: "memory-0",
      content: "The list lives in the shared sheet called Things.",
      warnings: [],
    },
    { sourceId: "memory-1", content: "Stay quiet when nothing changed.", warnings: [] },
  ],
  routines: [
    {
      sourceId: "routine-0",
      title: "morning-check",
      prompt: "Run the check-the-list skill and report only what changed.",
      schedule: { kind: "daily", dailyAt: "08:44", weekdays: [1, 2, 3, 4, 5] },
      state: "active",
      note: null,
    },
    {
      sourceId: "routine-1",
      title: "weekly-summary",
      prompt: "Run the weekly-summary skill.",
      schedule: { kind: "daily", dailyAt: "08:49", weekdays: [1] },
      state: "active",
      note: null,
    },
  ],
  integrations: [
    { name: "Google Calendar", description: "Reads events.", pluginId: "google" },
    { name: "Ramp", description: "Reads card spend.", pluginId: null },
  ],
  warnings: [],
  ...over,
});
