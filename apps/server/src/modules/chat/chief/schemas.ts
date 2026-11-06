import { OUTPUT_STYLE_KEYS, OUTPUT_STYLE_SCOPES } from "@zetta/db/schema/output-styles";
import { TEAM_ROLE_COLORS, TEAM_ROLE_ICONS } from "@zetta/db/schema/teams";
import { z } from "zod";

import { decisionConfigSchema } from "../routing";

/**
 * Blocks only the chief may send, one kind per feature. A bot, team, routine or style is named by its name or its id (the chief has the
 * lists in its prompt). Every action that changes something becomes a card the user approves (see `run.ts`); `list`, `get` and `export` read.
 */
const bounded = (n: number) => z.string().trim().min(1).max(n);
const ref = bounded(200);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
const harness = z.enum([
  "pi",
  "codex",
  "omp",
  "claude-code",
  "opencode",
  "cursor",
  "hermes",
  "deepseek",
  "fixture",
  "decision",
]);
const connectionKey = z.strictObject({
  key: z.string().regex(/^[a-z0-9_-]{1,32}$/),
  provider: z.enum(["anthropic", "openai", "google", "openrouter", "deepseek", "github"]),
});
const schedule = {
  dailyAt: hhmm.optional(),
  everyMinutes: z.number().int().min(5).max(10080).optional(),
  onceAt: z.string().datetime({ offset: true }).optional(),
};

export const chiefSchemas = {
  bot: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("get"), bot: ref }),
    z
      .strictObject({
        action: z.literal("update"),
        bot: ref,
        name: bounded(80).optional(),
        description: z.string().max(2048).optional(),
        personality: z.string().max(4096).optional(),
        instructions: z.string().max(16384).optional(),
        harness: harness.optional(),
        model: z.string().max(128).nullable().optional(),
        outputStyle: z.enum(OUTPUT_STYLE_KEYS).optional(),
        outputStyleId: z.string().uuid().nullable().optional(),
        visibility: z.enum(["private", "team"]).optional(),
        computerMode: z.enum(["off", "browser", "desktop"]).optional(),
        codeAccess: z.boolean().optional(),
        commitIdentity: z.enum(["git-config", "bot", "account", "custom"]).optional(),
        commitEmail: z.email().max(254).nullable().optional(),
        requiredConnections: z.array(connectionKey).max(8).optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({
      action: z.literal("move"),
      bot: ref,
      /** A folder name or id; null takes the bot out of every folder. */
      folder: ref.nullable(),
    }),
    z.strictObject({ action: z.literal("archive"), bot: ref }),
  ]),
  folder: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({
      action: z.literal("create"),
      name: bounded(80),
      parent: ref.optional(),
    }),
    z.strictObject({ action: z.literal("rename"), folder: ref, name: bounded(80) }),
    z.strictObject({ action: z.literal("remove"), folder: ref }),
  ]),
  routine: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({
      action: z.literal("create"),
      bot: ref,
      title: bounded(120),
      prompt: bounded(8000),
      timezone: bounded(64),
      ...schedule,
      conversationMode: z.enum(["new", "continue"]).optional(),
      workflowId: z.string().uuid().optional(),
      /** Switch it on once it exists (default). `false` leaves it paused. */
      activate: z.boolean().default(true),
    }),
    z
      .strictObject({
        action: z.literal("update"),
        routine: ref,
        bot: ref.optional(),
        title: bounded(120).optional(),
        prompt: bounded(8000).optional(),
        timezone: bounded(64).optional(),
        ...schedule,
        conversationMode: z.enum(["new", "continue"]).optional(),
        workflowId: z.string().uuid().optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("pause"), routine: ref }),
    z.strictObject({ action: z.literal("resume"), routine: ref }),
    z.strictObject({ action: z.literal("run_now"), routine: ref }),
    z.strictObject({ action: z.literal("remove"), routine: ref }),
  ]),
  team: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z
      .strictObject({
        action: z.literal("update"),
        team: ref,
        name: bounded(80).optional(),
        goal: z.string().max(1000).optional(),
        context: z.string().max(8000).optional(),
        /** Bots to add; "role" is a name from the team roles list. */
        add: z
          .array(z.strictObject({ bot: ref, role: z.string().max(60).default("") }))
          .max(12)
          .optional(),
        /** Bots to take out. The team's chief cannot be removed. */
        remove: z.array(ref).max(12).optional(),
        /** New roles for members already in the team ("" clears the role). */
        roles: z
          .array(z.strictObject({ bot: ref, role: z.string().max(60) }))
          .max(12)
          .optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("archive"), team: ref }),
    /** A project room for the team that waits: the chief leads it, the team's bots join, nobody is woken until the user writes. */
    z.strictObject({
      action: z.literal("open_room"),
      team: ref,
      title: bounded(120),
      goal: z.string().max(1000).default(""),
      context: z.string().max(8000).optional(),
    }),
    z.strictObject({
      action: z.literal("role_create"),
      name: bounded(60),
      description: z.string().max(200).default(""),
      color: z.enum(TEAM_ROLE_COLORS).optional(),
      icon: z.enum(TEAM_ROLE_ICONS).optional(),
    }),
    z
      .strictObject({
        action: z.literal("role_update"),
        role: ref,
        name: bounded(60).optional(),
        description: z.string().max(200).optional(),
        color: z.enum(TEAM_ROLE_COLORS).optional(),
        icon: z.enum(TEAM_ROLE_ICONS).optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("role_remove"), role: ref }),
  ]),
  output_style: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("export"), style: ref }),
    z.strictObject({
      action: z.literal("create"),
      name: bounded(80),
      description: z.string().max(300).default(""),
      body: bounded(8000),
      scope: z.enum(OUTPUT_STYLE_SCOPES).optional(),
    }),
    z.strictObject({ action: z.literal("import"), markdown: bounded(20_000) }),
    z
      .strictObject({
        action: z.literal("update"),
        style: ref,
        name: bounded(80).optional(),
        description: z.string().max(300).optional(),
        body: bounded(8000).optional(),
        scope: z.enum(OUTPUT_STYLE_SCOPES).optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("archive"), style: ref }),
  ]),
  artifacts: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("pin"), artifact: ref }),
    z.strictObject({ action: z.literal("unpin"), artifact: ref }),
    z.strictObject({ action: z.literal("remove"), artifact: ref }),
  ]),
  plugins: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("test"), plugin: ref }),
    z.strictObject({ action: z.literal("bind"), bot: ref, plugin: ref }),
    z.strictObject({ action: z.literal("unbind"), bot: ref, plugin: ref }),
    z.strictObject({ action: z.literal("disconnect"), plugin: ref }),
    z.strictObject({ action: z.literal("uninstall"), plugin: ref }),
  ]),
  mcp_server: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({
      action: z.literal("add"),
      name: z.string().regex(/^[a-z0-9_-]{1,32}$/),
      url: z.string().url().max(2000),
    }),
    z.strictObject({ action: z.literal("remove"), server: ref }),
    z.strictObject({ action: z.literal("bind"), bot: ref, server: ref }),
    z.strictObject({ action: z.literal("unbind"), bot: ref, server: ref }),
    z.strictObject({
      action: z.literal("tools"),
      bot: ref,
      server: ref,
      mode: z.enum(["all", "selected"]),
      allow: z.array(bounded(200)).max(200).default([]),
    }),
  ]),
  skill_library: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({
      action: z.literal("create"),
      name: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
      description: bounded(600),
      body: bounded(24_000),
    }),
    z
      .strictObject({
        action: z.literal("update"),
        skill: ref,
        description: bounded(600).optional(),
        body: bounded(24_000).optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("archive"), skill: ref }),
    /** Gives the skill to more bots; the bots that have it keep it. */
    z.strictObject({ action: z.literal("attach"), skill: ref, bots: z.array(ref).min(1).max(50) }),
  ]),
  hook: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list"), bot: ref }),
    z.strictObject({ action: z.literal("dry_run"), bot: ref, text: bounded(20_000) }),
    z.strictObject({
      action: z.literal("add"),
      bot: ref,
      kind: z.enum(["add_context", "redact", "stop", "background"]),
      pattern: z.string().max(100).optional(),
      value: z.string().max(4000).optional(),
    }),
    z
      .strictObject({
        action: z.literal("update"),
        bot: ref,
        hook: z.string().uuid(),
        pattern: z.string().max(100).optional(),
        value: z.string().max(4000).optional(),
        enabled: z.boolean().optional(),
        position: z.number().int().min(0).max(100).optional(),
      })
      .refine((v) => Object.keys(v).length > 3, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("remove"), bot: ref, hook: z.string().uuid() }),
  ]),
  claude: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list"), bot: ref }),
    z.strictObject({
      action: z.literal("add"),
      bot: ref,
      kind: z.enum(["skill", "agent"]),
      name: z.string().regex(/^[a-z][a-z0-9-]{0,62}$/),
      description: bounded(600),
      body: bounded(24_000),
      tools: z
        .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/))
        .max(30)
        .default([]),
      model: z.enum(["inherit", "sonnet", "opus", "haiku"]).nullable().default(null),
    }),
    z
      .strictObject({
        action: z.literal("update"),
        bot: ref,
        asset: ref,
        description: bounded(600).optional(),
        body: bounded(24_000).optional(),
        tools: z
          .array(z.string().regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/))
          .max(30)
          .optional(),
        model: z.enum(["inherit", "sonnet", "opus", "haiku"]).nullable().optional(),
        enabled: z.boolean().optional(),
      })
      .refine((v) => Object.keys(v).length > 3, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("remove"), bot: ref, asset: ref }),
    /** How hard a Claude Code bot thinks and the most one run may spend, in cents (null removes the limit). */
    z
      .strictObject({
        action: z.literal("limits"),
        bot: ref,
        effort: z.enum(["low", "medium", "high", "xhigh", "max"]).nullable().optional(),
        maxBudgetCents: z.number().int().min(1).max(10_000).nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give effort or maxBudgetCents" }),
  ]),
  room: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("pause"), room: ref }),
    z.strictObject({ action: z.literal("resume"), room: ref }),
    z.strictObject({ action: z.literal("cancel"), room: ref }),
    z.strictObject({ action: z.literal("silence"), room: ref }),
    z.strictObject({ action: z.literal("stop_goals"), room: ref }),
    z.strictObject({
      action: z.literal("require_approval"),
      room: ref,
      bot: ref,
      on: z.boolean(),
    }),
    z.strictObject({ action: z.literal("set_team"), room: ref, team: ref.nullable() }),
    /** The bots this bot may open rooms with without asking the user. The list replaces the old one. */
    z.strictObject({ action: z.literal("peers"), bot: ref, peers: z.array(ref).max(20) }),
  ]),
  preferences: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("get") }),
    z
      .strictObject({
        action: z.literal("update"),
        timeFormat: z.enum(["24h", "12h"]).optional(),
        railMode: z.enum(["expanded", "collapsed"]).optional(),
        /** Bots in the order the sidebar shows them (names or ids). */
        botOrder: z.array(ref).max(200).optional(),
      })
      .refine((v) => Object.keys(v).length > 1, { message: "give at least one field to change" }),
  ]),
  conversation: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("list"),
      bot: ref.optional(),
      archived: z.boolean().optional(),
    }),
    z.strictObject({ action: z.literal("start"), bot: ref }),
    z.strictObject({ action: z.literal("rename"), conversation: ref, title: bounded(120) }),
    z.strictObject({
      action: z.enum(["pin", "unpin", "favorite", "unfavorite", "archive", "unarchive", "remove"]),
      conversation: ref,
    }),
  ]),
  attention: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("acknowledge"), item: z.string().uuid() }),
    z.strictObject({ action: z.literal("resolve"), item: z.string().uuid() }),
    z.strictObject({ action: z.literal("reopen"), item: z.string().uuid() }),
  ]),
  workflow: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({
      action: z.literal("run"),
      workflow: ref,
      input: z.string().max(8000).default(""),
    }),
  ]),
  computer: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("vms") }),
    z.strictObject({ action: z.literal("vm_start"), vm: ref.optional() }),
    z.strictObject({ action: z.literal("vm_stop"), vm: ref }),
    z.strictObject({ action: z.literal("vm_remove"), vm: ref }),
    z.strictObject({
      action: z.literal("keyboard"),
      vm: ref,
      layout: z.enum(["us", "us:intl", "br", "gb", "pt", "es", "latam", "de", "fr", "it"]),
    }),
  ]),
  snapshot: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("preview"), conversation: z.string().uuid() }),
    z.strictObject({ action: z.literal("publish"), conversation: z.string().uuid() }),
    z.strictObject({ action: z.literal("revoke"), snapshot: z.string().uuid() }),
  ]),
  source: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({
      action: z.literal("add"),
      kind: z.enum(["rss", "web"]),
      url: z.string().url().max(2000),
      label: bounded(100),
    }),
    /** Email (IMAP) and X sources need a login: this opens a form where the user types it. */
    z.strictObject({
      action: z.literal("add_login"),
      kind: z.enum(["email", "x"]),
      label: bounded(100).optional(),
    }),
    z.strictObject({ action: z.literal("remove"), source: ref }),
    z.strictObject({ action: z.literal("briefing"), sources: z.array(ref).max(10).optional() }),
  ]),
  company_docs: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("status") }),
    z.strictObject({ action: z.literal("enable") }),
    z.strictObject({ action: z.literal("disable") }),
    z.strictObject({ action: z.literal("sync") }),
  ]),
  connection: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    /** Opens a form where the user pastes the key: the key never passes through the chat. */
    z.strictObject({
      action: z.literal("add"),
      provider: z.enum(["anthropic", "openai", "google", "openrouter", "deepseek", "github"]),
      label: bounded(100).optional(),
    }),
    z.strictObject({ action: z.literal("revoke"), connection: ref }),
  ]),
  agenda_sync: z.discriminatedUnion("action", [
    z
      .strictObject({
        action: z.literal("settings"),
        enabled: z.boolean().optional(),
        pushByDefault: z.boolean().optional(),
        pushAccount: bounded(254).nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 1, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("sync_now") }),
  ]),
  browser_profile: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    /** Forgets the sign-ins saved in a browser profile; the profile can be used again. */
    z.strictObject({ action: z.literal("reset"), profile: ref }),
    /** Forgets the sign-ins and refuses to start the profile again. */
    z.strictObject({ action: z.literal("remove"), profile: ref }),
  ]),
  decision: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("get"), bot: ref }),
    z.strictObject({ action: z.literal("preview"), bot: ref, text: bounded(8000) }),
    z.strictObject({ action: z.literal("set"), bot: ref, config: decisionConfigSchema }),
  ]),
  inbound_route: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    /** How often a bot's incoming-message route looks for new messages (20 to 3600 seconds). */
    z.strictObject({
      action: z.literal("interval"),
      bot: ref,
      plugin: ref,
      seconds: z.number().int().min(20).max(3600),
    }),
    z.strictObject({ action: z.literal("poll_now"), plugin: ref }),
  ]),
  /** Administrator only. Each opens a form: an invitation shows a one-time token, the installation settings change the whole server. */
  admin: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("invite") }),
    z.strictObject({ action: z.literal("installation") }),
  ]),
  memory_admin: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("suggestions") }),
    z.strictObject({
      action: z.literal("restore"),
      slug: bounded(80),
      version: z.number().int().min(1),
    }),
    z.strictObject({ action: z.literal("unarchive"), slug: bounded(80) }),
    z.strictObject({
      action: z.literal("decide_suggestion"),
      suggestion: z.string().uuid(),
      accept: z.boolean(),
    }),
  ]),
} as const;

export type ChiefKind = keyof typeof chiefSchemas;
export type ChiefArgs<K extends ChiefKind> = z.infer<(typeof chiefSchemas)[K]>;
