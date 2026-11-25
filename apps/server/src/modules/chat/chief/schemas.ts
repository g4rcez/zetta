import { BOT_ROLE_MAX } from "@zetta/core/bot-role";
import { isTimeZone, PROFILE_LIMITS, profileTextProblem } from "@zetta/core/person-profile";
import { ORG_DESCRIPTION_MAX, ORG_RANKS, ORG_TITLE_MAX, ORG_UNIT_MAX } from "@zetta/core/org";
import { PROJECT_BRIEF_MAX, PROJECT_STATUSES, PROJECT_WATCH } from "@zetta/db/schema/projects";
import { NAV_MODES, SIDEBAR_LIMITS, TEXT_SIZES, THEMES } from "@zetta/db/schema/preferences";
import { OUTPUT_STYLE_KEYS, OUTPUT_STYLE_SCOPES } from "@zetta/db/schema/output-styles";
import { TEAM_ROLE_COLORS, TEAM_ROLE_ICONS } from "@zetta/db/schema/teams";
import { SETTING_GROUPS } from "@zetta/core/settings";
import { SPEECH_NAME_PATTERN } from "@zetta/core/speech";
import { z } from "zod";

import { decisionConfigSchema } from "../routing";

/**
 * Blocks only the chief may send, one kind per feature. A bot, team, routine or style is named by its name or its id (the chief has the
 * lists in its prompt). Every action that changes something becomes a card the user approves (see `run.ts`); `list`, `get` and `export` read.
 */
const bounded = (n: number) => z.string().trim().min(1).max(n);
const ref = bounded(200);
const hhmm = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/);
/** A profile line the person writes about themselves: plain text, empty to clear it. */
const profileLine = (max: number, multiline = false) =>
  z
    .string()
    .trim()
    .max(max)
    .refine((v) => profileTextProblem(v, multiline) === undefined, { message: "plain text only" });
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
  /** Days a dailyAt routine runs on: 0 = Sunday … 6 = Saturday. Empty or left out = every day. */
  weekdays: z.array(z.number().int().min(0).max(6)).max(7).optional(),
  /** The schedule in words or a cron ("Monday to Friday at 8:30", "every 15 minutes", "0 9 * * 1-5"), read instead of the fields. */
  when: bounded(200).optional(),
  everyMinutes: z.number().int().min(5).max(10080).optional(),
  onceAt: z.string().datetime({ offset: true }).optional(),
};

const lessonIds = z.array(z.string().uuid()).min(1).max(20);
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
        /** What the bot is for, in a few words; shown beside its name wherever a bot is chosen. "" clears it. */
        role: z.string().trim().max(BOT_ROLE_MAX).optional(),
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
        // Chat memory (chat/context.ts): null is the default of each.
        contextBytes: z.number().int().min(4000).max(60000).nullable().optional(),
        summaryMode: z.enum(["chief", "bot", "off"]).optional(),
        summaryMaxChars: z.number().int().min(500).max(6000).nullable().optional(),
        summaryGapBytes: z.number().int().min(500).max(20000).nullable().optional(),
        chatSearchLimit: z.number().int().min(1).max(10).nullable().optional(),
        /** The speech provider's own voice name or id ("" or null: the installation's voice), and the language it speaks ("pt-BR"). */
        voice: z
          .string()
          .trim()
          .max(100)
          .regex(SPEECH_NAME_PATTERN)
          .transform((v) => v || null)
          .nullable()
          .optional(),
        voiceLanguage: z
          .string()
          .trim()
          .max(35)
          .transform((v) => v || null)
          .nullable()
          .optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({
      action: z.literal("move"),
      bot: ref,
      /** A folder name or id; null takes the bot out of every folder. */
      folder: ref.nullable(),
    }),
    z.strictObject({ action: z.literal("archive"), bot: ref }),
    /** The numbers of a bot (runs, how long they take, how often the person stepped in, ratings) over 7 or 30 days. */
    z.strictObject({
      action: z.literal("stats"),
      bot: ref,
      days: z.union([z.literal(7), z.literal(30)]).optional(),
    }),
    /** The saved versions of a bot, newest first, with what each one changed. */
    z.strictObject({ action: z.literal("history"), bot: ref }),
    /** Brings a past version of a bot back as a new version (a card). */
    z.strictObject({
      action: z.literal("restore"),
      bot: ref,
      version: z.number().int().positive(),
    }),
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
  /**
   * What the bots learned from their owner. list and stats read; the rest wait for the owner's approval, and nothing is deleted: a dropped
   * lesson is archived and can be brought back. `ids` are lesson ids from list.
   */
  lessons: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("list"),
      bot: z.string().uuid().optional(),
      status: z.enum(["waiting", "trial", "kept", "dropped", "all"]).optional(),
      label: z.enum(["helps", "unclear", "hurts", "unused"]).optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    z.strictObject({ action: z.literal("stats"), bot: z.string().uuid() }),
    z.strictObject({ action: z.literal("keep"), ids: lessonIds }),
    z.strictObject({ action: z.literal("drop"), ids: lessonIds }),
    z.strictObject({ action: z.literal("restore"), ids: lessonIds }),
    z.strictObject({ action: z.literal("accept"), ids: lessonIds }),
    z.strictObject({ action: z.literal("reject"), ids: lessonIds }),
  ]),
  /**
   * The person's mailboxes. list and get read (never a password, never a message). assign, label and remove are cards. connect opens a
   * form: the address, servers and password are typed in the browser and sealed there. There is no way to turn sending on or off, to read
   * a password or to set one: those stay with the person.
   */
  mailbox: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("get"), mailbox: ref }),
    z.strictObject({
      action: z.literal("connect"),
      address: z.string().trim().max(320).optional(),
      label: z.string().trim().max(120).optional(),
      bot: ref.optional(),
    }),
    /** `bot` is a name or id; null (or the Chief) leaves the mailbox with the Chief. */
    z.strictObject({ action: z.literal("assign"), mailbox: ref, bot: ref.nullable() }),
    z.strictObject({ action: z.literal("label"), mailbox: ref, label: z.string().trim().max(120) }),
    z.strictObject({ action: z.literal("remove"), mailbox: ref }),
    /** A bot's own e-mail address (only where the administrator set up bot addresses): a card, then the address is made. */
    z.strictObject({ action: z.literal("give_address"), bot: ref }),
    /** Who may write to a bot's own address: addresses or @domains, replacing the list. */
    z.strictObject({
      action: z.literal("senders"),
      mailbox: ref,
      senders: z.array(z.string().trim().min(1).max(320)).max(200),
    }),
  ]),
  /**
   * A bot's phone number (modules/phone). get and list read (list is for administrators). request, release, settings, approve, reject, attach,
   * reassign and optout are cards. The keypad PIN has no action here on purpose: it is typed in the bot's settings and the model never sees it.
   */
  phone: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("get"), bot: ref }),
    z.strictObject({
      action: z.literal("request"),
      bot: ref,
      country: z.string().trim().length(2),
      area_code: z.string().trim().max(6).optional(),
      /** Telnyx or Twilio; left out, the server's default provider. */
      provider: z.enum(["telnyx", "twilio"]).optional(),
    }),
    z.strictObject({ action: z.literal("release"), bot: ref }),
    z.strictObject({
      action: z.literal("settings"),
      bot: ref,
      inbound: z.enum(["anyone", "owner_only", "off"]).optional(),
      outbound: z.enum(["on", "off"]).optional(),
      owner_number: z.string().trim().max(32).nullable().optional(),
    }),
    z.strictObject({ action: z.literal("list") }),
    /** Call history (a read): who was called or called, how it went, how long. Never what was said. */
    z.strictObject({
      action: z.literal("calls"),
      bot: ref.optional(),
      limit: z.number().int().min(1).max(50).optional(),
    }),
    z.strictObject({ action: z.literal("approve"), bot: ref }),
    z.strictObject({ action: z.literal("reject"), bot: ref }),
    /** An administrator gives a bot a number the provider account already holds, or moves a number to another bot. */
    z.strictObject({
      action: z.literal("attach"),
      bot: ref,
      number: z.string().trim().min(1).max(32),
      provider: z.enum(["telnyx", "twilio"]).optional(),
    }),
    z.strictObject({
      action: z.literal("reassign"),
      number: z.string().trim().min(1).max(64),
      bot: ref,
    }),
    z.strictObject({ action: z.literal("optout"), number: z.string().trim().min(1).max(32) }),
  ]),
  /**
   * Server settings (modules/settings), administrators only. list and get read. set and reset are cards. A security-policy key is refused
   * by set and reset (a person changes it in Studio > Server settings). A switch is the text "on" or "off".
   */
  setting: z.discriminatedUnion("action", [
    z.strictObject({
      action: z.literal("list"),
      group: z.enum(Object.keys(SETTING_GROUPS) as [string, ...string[]]).optional(),
    }),
    z.strictObject({ action: z.literal("get"), key: bounded(80) }),
    z.strictObject({
      action: z.literal("set"),
      key: bounded(80),
      value: z.union([z.string().max(20_000), z.number(), z.array(z.string().max(2000)).max(256)]),
    }),
    z.strictObject({ action: z.literal("reset"), key: bounded(80) }),
  ]),
  /** The company chart: seats that report to seats, held by people or team bots. Only an administrator changes it. */
  org: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    /** The bots of the chart that work together (shared rooms, workflows, decision handoffs). A read. */
    z.strictObject({ action: z.literal("works_with") }),
    z.strictObject({
      action: z.literal("add_seat"),
      /** The seat the new one reports to. Left out only when the chart is empty (the first seat is the CEO). */
      under: ref.optional(),
      /** A key of the role templates (ceo, cto, support-agent, ...). */
      template: bounded(60).optional(),
      title: bounded(ORG_TITLE_MAX).optional(),
      rank: z.enum(ORG_RANKS).optional(),
      unit: z.string().trim().max(ORG_UNIT_MAX).optional(),
      description: z.string().trim().max(ORG_DESCRIPTION_MAX).optional(),
    }),
    z
      .strictObject({
        action: z.literal("update"),
        seat: ref,
        title: bounded(ORG_TITLE_MAX).optional(),
        description: z.string().trim().max(ORG_DESCRIPTION_MAX).optional(),
        unit: z.string().trim().max(ORG_UNIT_MAX).optional(),
        rank: z.enum(ORG_RANKS).optional(),
        /** One of the admin's own teams by name or id, or null to unlink. */
        team: ref.nullable().optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({
      action: z.literal("seat"),
      seat: ref,
      holder: z.discriminatedUnion("kind", [
        z.strictObject({ kind: z.literal("open") }),
        z.strictObject({ kind: z.literal("person"), who: ref }),
        z.strictObject({ kind: z.literal("bot"), who: ref }),
      ]),
    }),
    z
      .strictObject({
        action: z.literal("move"),
        seat: ref,
        /** The seat it reports to from now on. Left out, the seat stays where it reports and only changes its place (`index`). */
        under: ref.optional(),
        /** Its place among the seats that report to the same manager, from 0. */
        index: z.number().int().min(0).max(1000).optional(),
      })
      .refine((v) => v.under !== undefined || v.index !== undefined, {
        message: "say where to move it: under a seat, an index, or both",
      }),
    z.strictObject({ action: z.literal("remove"), seat: ref }),
    z.strictObject({
      action: z.literal("apply_template"),
      template: bounded(60),
      under: ref.optional(),
    }),
  ]),
  /** Work a person follows as one thing: a brief, the bots and people on it, its rooms and its tasks. */
  project: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("list") }),
    z.strictObject({ action: z.literal("get"), project: ref }),
    z.strictObject({
      action: z.literal("create"),
      name: bounded(120),
      outcome: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
      audience: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
      doneWhen: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
      notIncluded: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
      labels: z.array(bounded(32)).max(10).optional(),
      watch: z.enum(PROJECT_WATCH).optional(),
      bots: z.array(ref).max(30).optional(),
      people: z.array(ref).max(30).optional(),
    }),
    z
      .strictObject({
        action: z.literal("update"),
        project: ref,
        name: bounded(120).optional(),
        outcome: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
        audience: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
        doneWhen: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
        notIncluded: z.string().trim().max(PROJECT_BRIEF_MAX).optional(),
        labels: z.array(bounded(32)).max(10).optional(),
        watch: z.enum(PROJECT_WATCH).optional(),
        status: z.enum(PROJECT_STATUSES).optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    /** Who works on it: these lists replace the old ones. People are from the owner's teams. */
    z.strictObject({
      action: z.literal("members"),
      project: ref,
      bots: z.array(ref).max(30),
      people: z.array(ref).max(30),
    }),
    /** The rooms that work for it: this list replaces the old one. */
    z.strictObject({ action: z.literal("rooms"), project: ref, rooms: z.array(ref).max(30) }),
    /** Asks someone on the project for something: a task on the project, and a bot starts on it at once. */
    z.strictObject({
      action: z.literal("add_work"),
      project: ref,
      to: z.strictObject({ kind: z.enum(["bot", "person"]), who: ref }),
      text: bounded(4000),
    }),
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
    /** One routine with its triggers (what else starts it). A trigger's secret is never shown here. */
    z.strictObject({ action: z.literal("get"), routine: ref }),
    z
      .strictObject({
        action: z.literal("trigger_add"),
        routine: ref,
        /** A webhook opens a form for the person: its secret is shown only to them. */
        kind: z.enum(["gmail", "home_assistant", "webhook"]),
        query: bounded(200).optional(),
        entityId: z
          .string()
          .regex(/^[a-z0-9_]{1,64}\.[a-z0-9_]{1,64}$/)
          .optional(),
        to: z.string().trim().min(1).max(50).optional(),
      })
      .refine((v) => v.kind !== "gmail" || !!v.query, { message: "a Gmail trigger needs a query" })
      .refine((v) => v.kind !== "home_assistant" || !!v.entityId, {
        message: "a Home Assistant trigger needs an entityId such as light.kitchen",
      }),
    /** `trigger` is an id from routine get. A new webhook secret (rotate) opens a form: the secret is shown only to the person. */
    z.strictObject({
      action: z.enum(["trigger_pause", "trigger_resume", "trigger_remove", "trigger_rotate"]),
      routine: ref,
      trigger: ref,
    }),
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
    /** One team with its bots and its people. */
    z.strictObject({ action: z.literal("get"), team: ref }),
    /** People of the installation (by name or id) the owner adds to the team: they read its rooms. */
    z.strictObject({
      action: z.literal("add_people"),
      team: ref,
      people: z.array(ref).min(1).max(12),
    }),
    z.strictObject({
      action: z.literal("remove_people"),
      team: ref,
      people: z.array(ref).min(1).max(12),
    }),
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
      body: bounded(64_000),
    }),
    z.strictObject({ action: z.literal("read"), skill: ref }),
    z
      .strictObject({
        action: z.literal("update"),
        skill: ref,
        name: z
          .string()
          .regex(/^[a-z][a-z0-9-]{0,62}$/)
          .optional(),
        description: bounded(600).optional(),
        body: bounded(64_000).optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
    z.strictObject({ action: z.literal("archive"), skill: ref }),
    /** Gives the skill to more bots; the bots that have it keep it. */
    z.strictObject({ action: z.literal("attach"), skill: ref, bots: z.array(ref).min(1).max(50) }),
    /** Takes the skill from these bots; the skill stays in the library. */
    z.strictObject({ action: z.literal("detach"), skill: ref, bots: z.array(ref).min(1).max(50) }),
    /** Brings back a skill that was deleted. */
    z.strictObject({ action: z.literal("restore"), skill: ref }),
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
        /** The size of chat and document text. */
        textSize: z.enum(TEXT_SIZES).optional(),
        railMode: z.enum(["expanded", "collapsed"]).optional(),
        sidebarSide: z.enum(["left", "right"]).optional(),
        /** "simple" hides the Advanced group of the sidebar. */
        navMode: z.enum(NAV_MODES).optional(),
        /** The color theme, or null to follow the device. */
        theme: z.enum(THEMES).nullable().optional(),
        /** The main color as #rrggbb, or null for the theme's own. */
        primaryColor: z
          .string()
          .regex(/^#[0-9a-f]{6}$/i)
          .transform((v) => v.toLowerCase())
          .nullable()
          .optional(),
        railWidth: z
          .number()
          .int()
          .min(SIDEBAR_LIMITS.railWidth.min)
          .max(SIDEBAR_LIMITS.railWidth.max)
          .optional(),
        listWidth: z
          .number()
          .int()
          .min(SIDEBAR_LIMITS.listWidth.min)
          .max(SIDEBAR_LIMITS.listWidth.max)
          .optional(),
        /** Bots in the order the sidebar shows them (names or ids). */
        botOrder: z.array(ref).max(200).optional(),
        /** Rooms in the order the sidebar shows them (titles or ids). */
        roomOrder: z.array(ref).max(200).optional(),
      })
      .refine((v) => Object.keys(v).length > 1, { message: "give at least one field to change" }),
    /** What the person says about themselves: name, job title, department, about, time zone, contact. The picture and the email are not changed here. */
    z
      .strictObject({
        action: z.literal("profile"),
        name: bounded(80)
          .refine((s) => !/\p{Cc}/u.test(s), { message: "no control characters" })
          .optional(),
        jobTitle: profileLine(PROFILE_LIMITS.jobTitle).optional(),
        department: profileLine(PROFILE_LIMITS.department).optional(),
        about: profileLine(PROFILE_LIMITS.about, true).optional(),
        /** An IANA name such as "America/Sao_Paulo", or "" for the browser's. */
        timezone: z
          .string()
          .trim()
          .max(PROFILE_LIMITS.timezone)
          .refine((v) => v === "" || isTimeZone(v), { message: "an IANA time zone name" })
          .optional(),
        contact: profileLine(PROFILE_LIMITS.contact).optional(),
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
    /** One workflow with its graph, to edit from. */
    z.strictObject({ action: z.literal("get"), workflow: ref }),
    z
      .strictObject({
        action: z.literal("update"),
        workflow: ref,
        name: bounded(80).optional(),
        /** The whole new graph; it is checked before the card is made. */
        graph: z
          .record(z.string(), z.unknown())
          .refine((g) => JSON.stringify(g).length <= 60_000, { message: "the graph is too large" })
          .optional(),
      })
      .refine((v) => Object.keys(v).length > 2, { message: "give at least one field to change" }),
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
  /** A bot from the Grok Bot marketplace. `source` is the bot's x.ai page address or its id. */
  import_bot: z.discriminatedUnion("action", [
    z.strictObject({ action: z.literal("preview"), source: bounded(300) }),
    z.strictObject({
      action: z.literal("install"),
      source: bounded(300),
      /** The IANA timezone the bot's routines run in: the person's own. */
      timezone: bounded(64),
    }),
  ]),
} as const;

export type ChiefKind = keyof typeof chiefSchemas;
export type ChiefArgs<K extends ChiefKind> = z.infer<(typeof chiefSchemas)[K]>;
