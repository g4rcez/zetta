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
import { WIKI_LIMITS, WikiError, type Wiki } from "../wiki/service";

/**
 * Zetta's own MCP server: external AI clients (Claude Code, Cursor, …) act as one member through the same services as the web app, so
 * ownership checks, validation and audit stay in those services. Integrations' `mcp.ts` is the other direction (Zetta as an MCP client).
 */
export type ZettaMcpServices = {
  chat: ChatService;
  mcp: Mcp;
  connections: ConnectionsService;
  features: FeaturesService;
  wiki: Wiki;
  tasks: TaskStore;
  outputStyles: OutputStyles;
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
        : e instanceof McpError || e instanceof WikiError || e instanceof OutputStyleError
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
  const { chat, mcp, connections, features, wiki, tasks, outputStyles } = services;
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
        "routines, workflows, output styles, memory and tasks. Bots shared with the team are listed with canEdit=false. " +
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

  server.registerTool(
    "search_wiki",
    {
      title: "Search memory",
      description:
        "Search the member's memory items (a graph: each has tags, a howto, a score and typed links), or list them (with items shared with the installation) when `query` is empty.",
      inputSchema: z.object({ query: z.string().max(200).optional() }),
      ...READ,
    },
    ({ query }) =>
      run(async () =>
        query?.trim()
          ? { pages: await wiki.search(actor.userId, query, 50) }
          : { pages: await wiki.list(actor.userId), shared: await wiki.listShared(actor.userId) },
      ),
  );

  server.registerTool(
    "read_wiki_page",
    {
      title: "Read memory item",
      description: "One memory item by slug, with its links to and from other items.",
      inputSchema: z.object({ slug: z.string().trim().min(1).max(WIKI_LIMITS.slug) }),
      ...READ,
    },
    ({ slug }) =>
      run(async () => {
        const r = await wiki.read(actor.userId, slug);
        if (!r) throw new WikiError("NOT_FOUND");
        return { access: r.access, page: r.page, links: r.links, linkedFrom: r.linkedFrom };
      }),
  );

  return server;
}
