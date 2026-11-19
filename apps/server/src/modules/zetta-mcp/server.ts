import { MCP_SCOPES } from "@zetta/auth";
import { McpServer, requireScopes, type CallToolResult } from "@modelcontextprotocol/server";
import { OUTPUT_STYLE_KEYS, OUTPUT_STYLE_SCOPES } from "@zetta/db/schema/output-styles";
import { z } from "zod";

import type { ChatService } from "../chat/service";
import type { ConnectionsService } from "../connections/service";
import { auditToolDetail, type audit } from "../features/audit";
import type { FeaturesService } from "../features/service";
import { AccessError, type ActiveActor } from "../identity/access";
import { McpError, type Mcp } from "../integrations/mcp";
import { BUILTIN_KEYS } from "../output-styles/builtins";
import { STYLE_LIMITS } from "../output-styles/format";
import { OutputStyleError, type OutputStyles } from "../output-styles/service";
import type { TaskStore } from "../tasks/store";
import { MEMORY_LIMITS, MemoryError, type Memory } from "../memory/service";
import {
  orgBodies,
  orgDescription,
  orgHolder,
  orgRank,
  orgTitle,
  orgUnit,
  orgUuid,
  orgVersion,
} from "../org/inputs";
import { OrgError, type OrgStore, type OrgView } from "../org/store";
import type { LessonTools } from "../learning/workflow-tool";

/**
 * Zetta's own MCP server: external AI clients (Claude Code, Cursor, …) act as one member through the same services as the web app, so
 * ownership checks, validation and audit stay in those services. Integrations' `mcp.ts` is the other direction (Zetta as an MCP client).
 */
export type ZettaMcpServices = {
  chat: ChatService;
  mcp: Mcp;
  connections: ConnectionsService;
  features: FeaturesService;
  memory: Memory;
  tasks: TaskStore;
  outputStyles: OutputStyles;
  /** The company chart: any member reads it; only the administrator gets the write tools. */
  org: Pick<
    OrgStore,
    "get" | "links" | "create" | "update" | "move" | "seat" | "remove" | "applyPreset"
  >;
  /** What the member's bots learned (modules/learning): any member reads their own, a change needs the write scope. */
  lessons: { tools: LessonTools };
  /** Records a write the client made on the member's behalf (best effort, never throws). */
  audit: (ownerUserId: string, event: Parameters<typeof audit>[2]) => Promise<void>;
};

const uuid = z.string().uuid();
const READ = {
  scopeChallenge: requireScopes(MCP_SCOPES.read),
  annotations: { readOnlyHint: true, openWorldHint: false },
};
/** A tool that changes something needs the write scope, which the member granted on the consent page. */
const WRITE = {
  scopeChallenge: requireScopes(MCP_SCOPES.write),
  annotations: { readOnlyHint: false, destructiveHint: false, openWorldHint: false },
};
const styleName = z.string().trim().min(1).max(STYLE_LIMITS.name);
const styleDescription = z.string().trim().max(STYLE_LIMITS.description);
const styleBody = z.string().trim().min(1).max(STYLE_LIMITS.body);
const styleScope = z.enum(OUTPUT_STYLE_SCOPES);

function json(value: unknown): CallToolResult {
  return { content: [{ type: "text", text: JSON.stringify(value) }] };
}

/** Errors become a tool result the model can act on; unknown failures never show internals. */
function failure(e: unknown): CallToolResult {
  const text =
    e instanceof AccessError
      ? e.message
      : e instanceof z.ZodError
        ? `Invalid input: ${e.issues.map((i) => `${i.path.join(".") || "input"} ${i.message}`).join("; ")}`
        : e instanceof OrgError
          ? e.safe
          : e instanceof McpError || e instanceof MemoryError || e instanceof OutputStyleError
            ? e.code
            : (console.error("zetta-mcp: unhandled tool error", e),
              "Something went wrong. Please retry.");
  return { isError: true, content: [{ type: "text", text }] };
}

async function run(work: () => Promise<unknown>): Promise<CallToolResult> {
  try {
    return json(await work());
  } catch (e) {
    return failure(e);
  }
}

/** The chart as a model reads it: no avatars (a data URL of up to 300 KB), and ids for every seat, holder and team. */
function orgChartView(v: OrgView) {
  return {
    chart: v.chart,
    canEdit: v.canEdit,
    positions: v.positions.map((p) => ({
      id: p.id,
      parentId: p.parentId,
      rank: p.rank,
      title: p.title,
      description: p.description,
      unit: p.unit,
      sortOrder: p.sortOrder,
      seat: p.seat,
      holder: p.holder
        ? p.holder.kind === "person"
          ? { kind: "person", userId: p.holder.userId, name: p.holder.name }
          : { kind: "bot", botId: p.holder.botId, name: p.holder.name }
        : null,
      note: p.problem ? { code: p.problem.code, was: p.problem.was } : null,
      team: p.team,
    })),
    // Only the administrator gets who can be put in a seat and which of their own teams can be linked.
    ...(v.palette
      ? {
          candidates: {
            people: v.palette.people.map((x) => ({ userId: x.userId, name: x.name })),
            bots: v.palette.bots.map((x) => ({
              id: x.id,
              name: x.name,
              description: x.description,
            })),
            teams: v.palette.teams,
          },
        }
      : {}),
  };
}

type Bot = Awaited<ReturnType<ChatService["listBots"]>>[number];
/** No avatar: a data URL of up to 300 KB that a model cannot use. */
function botView(actor: ActiveActor, b: Bot) {
  return {
    id: b.id,
    name: b.name,
    slug: b.slug,
    kind: b.kind,
    description: b.description,
    visibility: b.visibility,
    canEdit: b.ownerUserId === actor.userId,
    harness: b.harness,
    model: b.model,
    personality: b.personality,
    instructions: b.instructions,
    // Like personality and instructions, only the owner's own bots carry it.
    ...("outputStyle" in b ? { outputStyle: b.outputStyle, outputStyleId: b.outputStyleId } : {}),
    onboarded: b.onboarded,
    computerMode: b.computerMode,
    codeAccess: b.codeAccess,
    requiredConnections: b.requiredConnections,
    folderId: b.folderId,
    version: b.version,
  };
}

/** One server per request: it acts only as `actor`. */
export function createZettaMcpServer(services: ZettaMcpServices, actor: ActiveActor) {
  const { chat, mcp, connections, features, memory, tasks, outputStyles, org, lessons } = services;
  /** Runs a write and records it. The audit row names the tool and the thing changed, never the content. */
  async function runWrite(
    tool: string,
    work: () => Promise<unknown>,
    subject: { botId?: string; subjectId?: (result: unknown) => string | undefined } = {},
  ): Promise<CallToolResult> {
    const base = {
      kind: "tool_call",
      detail: auditToolDetail("mcp", tool),
      botId: subject.botId,
    } as const;
    try {
      const result = await work();
      await services.audit(actor.userId, {
        ...base,
        outcome: "ok",
        subjectId: subject.subjectId?.(result),
      });
      return json(result);
    } catch (e) {
      await services.audit(actor.userId, {
        ...base,
        outcome: e instanceof AccessError ? "denied" : "failed",
      });
      return failure(e);
    }
  }
  const server = new McpServer(
    { name: "zetta", version: "1.0.0" },
    {
      instructions:
        "Zetta runs AI bots for a team. Use these tools to inspect the signed-in member's bots, chats, integrations, connections, " +
        "routines, workflows, output styles, memory, what the bots learned (lessons), tasks and the company chart (who leads what, and who each person and bot reports to). " +
        "Only the administrator gets the tools that change the chart. Bots shared with the team are listed with canEdit=false. " +
        "Tools that change something need the write scope and are recorded in the member's activity log.",
    },
  );

  server.registerTool(
    "list_bots",
    {
      title: "List bots",
      description: "Bots the member owns or that are shared with the team.",
      ...READ,
    },
    () =>
      run(async () => {
        await chat.ensureChief(actor);
        return (await chat.listBots(actor)).map((b) => botView(actor, b));
      }),
  );

  server.registerTool(
    "list_conversations",
    {
      title: "List conversations",
      description:
        "The member's conversations, newest first. Filter by bot, kind, or archived state.",
      inputSchema: z.object({
        botId: uuid.optional(),
        kind: z.enum(["chat", "discussion", "inbound"]).optional(),
        archived: z.boolean().optional(),
      }),
      ...READ,
    },
    ({ botId, kind, archived }) =>
      run(() => chat.listConversations(actor, botId, kind, archived ?? false)),
  );

  server.registerTool(
    "list_messages",
    {
      title: "List messages",
      description:
        "Messages of one conversation in order. Page backwards with `before` (a message seq).",
      inputSchema: z.object({
        conversationId: uuid,
        before: z.number().int().positive().optional(),
        limit: z.number().int().min(1).max(500).optional(),
      }),
      ...READ,
    },
    ({ conversationId, before, limit }) =>
      run(async () =>
        (await chat.listMessages(actor, conversationId, { beforeSeq: before, limit })).map((m) => ({
          id: m.id,
          seq: m.seq,
          role: m.role,
          botId: m.botId,
          status: m.status,
          content: m.content,
          parentMessageId: m.parentMessageId,
          createdAt: m.createdAt,
        })),
      ),
  );

  server.registerTool(
    "list_mcp_servers",
    {
      title: "List MCP servers",
      description: "MCP servers the member added to Zetta (secrets are never included).",
      ...READ,
    },
    () => run(() => mcp.listServers(actor)),
  );

  server.registerTool(
    "list_bot_integrations",
    {
      title: "List bot integrations",
      description: "MCP servers and plugins the member connected to one bot.",
      inputSchema: z.object({ botId: uuid }),
      ...READ,
    },
    ({ botId }) =>
      run(async () => ({
        servers: await mcp.bound(actor, botId),
        plugins: await mcp.plugins.bindings(actor, botId),
      })),
  );

  server.registerTool(
    "list_plugins",
    {
      title: "List plugins",
      description: "Plugins Zetta offers (catalog) and the ones the member installed.",
      ...READ,
    },
    () =>
      run(async () => ({
        catalog: mcp.plugins.catalog(),
        installed: await mcp.plugins.list(actor),
      })),
  );

  server.registerTool(
    "list_connections",
    {
      title: "List connections",
      description:
        "The member's stored credentials (provider, label, state). Secret values are never returned.",
      ...READ,
    },
    () =>
      run(async () =>
        connections.configured()
          ? (await connections.list(actor)).filter((c) => c.provider !== "plugin")
          : [],
      ),
  );

  server.registerTool(
    "bot_connection_status",
    {
      title: "Bot connection status",
      description:
        "Which connections one bot requires and whether each is bound to a usable credential.",
      inputSchema: z.object({ botId: uuid }),
      ...READ,
    },
    ({ botId }) => run(() => connections.status(actor, botId)),
  );

  server.registerTool(
    "list_routines",
    { title: "List routines", description: "Scheduled routines and their state.", ...READ },
    () => run(() => features.routines.list(actor)),
  );

  server.registerTool(
    "list_workflows",
    { title: "List workflows", description: "Saved workflows.", ...READ },
    () => run(() => features.workflows.list(actor)),
  );

  server.registerTool(
    "list_output_styles",
    {
      title: "List output styles",
      description:
        "How bots write. `builtins` are the five built-in styles; `styles` are the member's own custom styles and the ones other members shared. " +
        "A bot's `outputStyle` is a built-in key, or `custom` with `outputStyleId` naming one of `styles`.",
      ...READ,
    },
    () => run(() => outputStyles.list(actor.userId)),
  );

  server.registerTool(
    "export_output_style",
    {
      title: "Export output style",
      description:
        "A style as a Claude Code style file (Markdown with name and description in the frontmatter). Give `id` for a custom style or `builtin` for a built-in one (Default has no text to export).",
      inputSchema: z.object({ id: uuid.optional(), builtin: z.enum(BUILTIN_KEYS).optional() }),
      ...READ,
    },
    ({ id, builtin }) =>
      run(async () => {
        if (!id === !builtin) throw new OutputStyleError("INVALID");
        return id
          ? outputStyles.exportStyle(actor.userId, id)
          : outputStyles.exportBuiltin(builtin!);
      }),
  );

  server.registerTool(
    "create_output_style",
    {
      title: "Create output style",
      description:
        "Saves a custom output style: how a bot writes. It is private unless `scope` is `installation`, which lets every member pick it for their bots.",
      inputSchema: z.object({
        name: styleName,
        description: styleDescription.default(""),
        body: styleBody,
        scope: styleScope.optional(),
      }),
      ...WRITE,
    },
    (v) =>
      runWrite(
        "create_output_style",
        async () => ({ style: await outputStyles.create(actor.userId, v) }),
        {
          subjectId: (r) => (r as { style: { id: string } }).style.id,
        },
      ),
  );

  server.registerTool(
    "update_output_style",
    {
      title: "Update output style",
      description:
        "Changes one of the member's own custom styles. Every bot that uses it writes the new way from its next turn. `expectedVersion` is the version you read.",
      inputSchema: z.object({
        id: uuid,
        expectedVersion: z.number().int().positive(),
        name: styleName.optional(),
        description: styleDescription.optional(),
        body: styleBody.optional(),
        scope: styleScope.optional(),
      }),
      ...WRITE,
    },
    ({ id, expectedVersion, ...v }) =>
      runWrite(
        "update_output_style",
        async () => ({ style: await outputStyles.update(actor.userId, id, expectedVersion, v) }),
        {
          subjectId: () => id,
        },
      ),
  );

  server.registerTool(
    "archive_output_style",
    {
      title: "Delete output style",
      description:
        "Deletes one of the member's own custom styles. Bots that use it keep writing that way until their style is changed.",
      inputSchema: z.object({ id: uuid }),
      ...WRITE,
      annotations: { ...WRITE.annotations, destructiveHint: true },
    },
    ({ id }) =>
      runWrite("archive_output_style", () => outputStyles.archive(actor.userId, id), {
        subjectId: () => id,
      }),
  );

  server.registerTool(
    "import_output_style",
    {
      title: "Import output style",
      description:
        "Creates a private custom style from a Claude Code style file: Markdown with `name` (and optionally `description`) in the frontmatter and the instructions below it.",
      inputSchema: z.object({ markdown: z.string().max(STYLE_LIMITS.file) }),
      ...WRITE,
    },
    ({ markdown }) =>
      runWrite(
        "import_output_style",
        async () => ({ style: await outputStyles.importMarkdown(actor.userId, markdown) }),
        {
          subjectId: (r) => (r as { style: { id: string } }).style.id,
        },
      ),
  );

  server.registerTool(
    "set_bot_output_style",
    {
      title: "Set a bot's output style",
      description:
        "Chooses how one of the member's own bots writes: a built-in key, or `custom` with `outputStyleId` from list_output_styles. " +
        "A built-in key needs no `outputStyleId`. `expectedVersion` is the bot's version from list_bots.",
      inputSchema: z.object({
        botId: uuid,
        expectedVersion: z.number().int().positive(),
        outputStyle: z.enum(OUTPUT_STYLE_KEYS),
        outputStyleId: uuid.nullable().optional(),
      }),
      ...WRITE,
    },
    ({ botId, expectedVersion, outputStyle, outputStyleId }) =>
      runWrite(
        "set_bot_output_style",
        async () => ({
          bot: botView(
            actor,
            await chat.updateBot(actor, botId, expectedVersion, {
              outputStyle,
              outputStyleId: outputStyle === "custom" ? (outputStyleId ?? null) : null,
            }),
          ),
        }),
        { botId, subjectId: () => botId },
      ),
  );

  server.registerTool(
    "list_tasks",
    { title: "List tasks", description: "The member's tasks.", ...READ },
    () => run(() => tasks.list(actor)),
  );

  // `search_wiki` and `read_wiki_page` are the old names of these two tools: clients that saved them keep working.
  for (const [searchName, readName, legacy] of [
    ["search_memory", "read_memory_item", ""],
    ["search_wiki", "read_wiki_page", " (old name of the memory tool)"],
  ] as const) {
    server.registerTool(
      searchName,
      {
        title: "Search memory",
        description: `Search the member's memory items (a graph: each has tags, a howto, a score and typed links), or list them (with items shared with the installation) when \`query\` is empty.${legacy}`,
        inputSchema: z.object({ query: z.string().max(200).optional() }),
        ...READ,
      },
      ({ query }) =>
        run(async () =>
          query?.trim()
            ? { pages: await memory.search(actor.userId, query, 50) }
            : {
                pages: await memory.list(actor.userId),
                shared: await memory.listShared(actor.userId),
              },
        ),
    );

    server.registerTool(
      readName,
      {
        title: "Read memory item",
        description: `One memory item by slug, with its links to and from other items.${legacy}`,
        inputSchema: z.object({ slug: z.string().trim().min(1).max(MEMORY_LIMITS.slug) }),
        ...READ,
      },
      ({ slug }) =>
        run(async () => {
          const r = await memory.read(actor.userId, slug);
          if (!r) throw new MemoryError("NOT_FOUND");
          return { access: r.access, page: r.page, links: r.links, linkedFrom: r.linkedFrom };
        }),
    );
  }

  server.registerTool(
    "list_lessons",
    {
      title: "List what the bots learned",
      description:
        "The lessons the member's bots follow, one line each: id | status | what happened after it was used | text. By default the ones in use (on trial or kept); `status` asks for waiting or dropped ones, `label` for the ones that hurt, help or were not used.",
      inputSchema: z.object({
        bot: uuid.optional(),
        status: z.enum(["waiting", "trial", "kept", "dropped", "all"]).optional(),
        label: z.enum(["helps", "unclear", "hurts", "unused"]).optional(),
        limit: z.number().int().min(1).max(50).optional(),
      }),
      ...READ,
    },
    (args) => run(async () => ({ lessons: await lessons.tools.call(actor.userId, "list", args) })),
  );

  server.registerTool(
    "get_lessons_progress",
    {
      title: "Is a bot getting better?",
      description:
        "How often the member had to step in after a bot's replies (stopped, redirected, corrected or rated down) in the last four weeks against the four before, and how many lessons are on trial, kept, dropped or waiting.",
      inputSchema: z.object({ bot: uuid }),
      ...READ,
    },
    (args) =>
      run(async () => ({ progress: await lessons.tools.call(actor.userId, "stats", args) })),
  );

  server.registerTool(
    "change_lessons",
    {
      title: "Keep, drop or bring back lessons",
      description:
        "Changes up to 20 lessons by id (from list_lessons): keep (after its trial), drop (archives it, nothing is deleted), restore (a dropped one comes back on trial), accept (a waiting one starts on trial) or reject (a waiting one is turned down).",
      inputSchema: z.object({
        action: z.enum(["keep", "drop", "restore", "accept", "reject"]),
        ids: z.array(uuid).min(1).max(20),
      }),
      ...WRITE,
    },
    ({ action, ids }) =>
      runWrite("change_lessons", async () => ({
        result: await lessons.tools.call(actor.userId, action, { ids }),
      })),
  );

  server.registerTool(
    "get_org_chart",
    {
      title: "Get the company chart",
      description:
        "The company chart: every seat with its level, unit, who holds it (a person or a team bot), who it reports to and the team it runs. " +
        "`chart.version` is the version the chart tools ask for. The administrator also gets who can be put in a seat.",
      ...READ,
    },
    () => run(async () => orgChartView(await org.get(actor))),
  );

  server.registerTool(
    "get_org_works_with",
    {
      title: "Get which bots work together",
      description:
        "Pairs of bots of the company chart that work together, from the rooms, workflows and decision handoffs of the person you act for. " +
        "`aId` and `bId` are bot ids (see get_org_chart for the seat each holds); `counts` says how many rooms, workflows and handoffs they share.",
      ...READ,
    },
    () => run(async () => ({ links: await org.links(actor) })),
  );

  // The tools that change the chart exist only for the administrator. The store checks it again on every call.
  if (actor.isAdmin) {
    const changed = (view: OrgView) => ({ org: orgChartView(view) });

    server.registerTool(
      "add_org_seat",
      {
        title: "Add a seat to the company chart",
        description:
          "Adds a seat under another seat, from a role template key (ceo, cto, support-agent, …) or with a title. The first seat of an empty chart is the CEO. `expectedVersion` is `chart.version` from get_org_chart.",
        inputSchema: z.object({
          expectedVersion: orgVersion,
          parentId: orgUuid.nullable().optional(),
          templateKey: z.string().trim().min(1).max(60).optional(),
          title: orgTitle.optional(),
          description: orgDescription.optional(),
          unit: orgUnit.optional(),
          rank: orgRank.optional(),
        }),
        ...WRITE,
      },
      ({ expectedVersion, ...v }) =>
        runWrite("add_org_seat", async () => changed(await org.create(actor, expectedVersion, v)), {
          subjectId: () => v.parentId ?? undefined,
        }),
    );

    server.registerTool(
      "update_org_seat",
      {
        title: "Change a seat of the company chart",
        description:
          "Changes the title, level, unit or description of a seat, or links (teamId, one of the administrator's own teams) or unlinks (null) the team it runs. The CEO stays the CEO.",
        inputSchema: z.object({ id: orgUuid, ...orgBodies.update.shape }),
        ...WRITE,
      },
      ({ id, expectedVersion, ...v }) =>
        runWrite(
          "update_org_seat",
          async () => changed(await org.update(actor, expectedVersion, id, v)),
          {
            subjectId: () => id,
          },
        ),
    );

    server.registerTool(
      "move_org_seat",
      {
        title: "Move a seat in the company chart",
        description:
          "Makes a seat report to another seat (parentId; the same parent to only reorder), at a place among its siblings (index, from 0; the end by default). A seat cannot report to itself or to its own reports.",
        inputSchema: z.object({ id: orgUuid, ...orgBodies.move.shape }),
        ...WRITE,
      },
      ({ id, expectedVersion, parentId, index }) =>
        runWrite(
          "move_org_seat",
          async () => changed(await org.move(actor, expectedVersion, id, parentId, index)),
          { subjectId: () => id },
        ),
    );

    server.registerTool(
      "set_org_seat_holder",
      {
        title: "Put a person or a bot in a seat",
        description:
          "Puts a member (kind person, with userId) or a bot shared with the team (kind bot, with botId) in a seat, or leaves it open (kind open). Private bots and personal chiefs cannot hold a seat.",
        inputSchema: z.object({ id: orgUuid, expectedVersion: orgVersion, holder: orgHolder }),
        ...WRITE,
      },
      ({ id, expectedVersion, holder }) =>
        runWrite(
          "set_org_seat_holder",
          async () => changed(await org.seat(actor, expectedVersion, id, holder)),
          {
            subjectId: () => id,
          },
        ),
    );

    server.registerTool(
      "remove_org_seat",
      {
        title: "Remove a seat from the company chart",
        description:
          "Removes a seat; the seats that reported to it report to its manager. The CEO can be removed only when nobody reports to it.",
        inputSchema: z.object({ id: orgUuid, expectedVersion: orgVersion }),
        ...WRITE,
        annotations: { ...WRITE.annotations, destructiveHint: true },
      },
      ({ id, expectedVersion }) =>
        runWrite(
          "remove_org_seat",
          async () => changed(await org.remove(actor, expectedVersion, id)),
          {
            subjectId: () => id,
          },
        ),
    );

    server.registerTool(
      "apply_org_template",
      {
        title: "Build a structure in the company chart from a template",
        description:
          "presetKey is small-startup, solo-founder or agency (an empty chart only), or product-team or support-desk (under a seat, underPositionId; on an empty chart they get an open CEO above them).",
        inputSchema: z.object(orgBodies.preset.shape),
        ...WRITE,
      },
      ({ expectedVersion, presetKey, underPositionId }) =>
        runWrite(
          "apply_org_template",
          async () =>
            changed(await org.applyPreset(actor, expectedVersion, presetKey, underPositionId)),
          { subjectId: () => underPositionId },
        ),
    );
  }

  return server;
}
