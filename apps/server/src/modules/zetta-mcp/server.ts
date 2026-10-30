import { MCP_SCOPES } from "@zetta/auth";
import { McpServer, requireScopes, type CallToolResult } from "@modelcontextprotocol/server";
import { z } from "zod";

import type { ChatService } from "../chat/service";
import type { ConnectionsService } from "../connections/service";
import type { FeaturesService } from "../features/service";
import { AccessError, type ActiveActor } from "../identity/access";
import { McpError, type Mcp } from "../integrations/mcp";
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
};

const uuid = z.string().uuid();
const READ = {
  scopeChallenge: requireScopes(MCP_SCOPES.read),
  annotations: { readOnlyHint: true, openWorldHint: false },
};

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
        : e instanceof McpError || e instanceof WikiError
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
    onboarded: b.onboarded,
    computerMode: b.computerMode,
    codeAccess: b.codeAccess,
    requiredConnections: b.requiredConnections,
    workspaceId: b.workspaceId,
    version: b.version,
  };
}

/** One server per request: it acts only as `actor`. */
export function createZettaMcpServer(services: ZettaMcpServices, actor: ActiveActor) {
  const { chat, mcp, connections, features, wiki, tasks } = services;
  const server = new McpServer(
    { name: "zetta", version: "1.0.0" },
    {
      instructions:
        "Zetta runs AI bots for a team. Use these tools to inspect the signed-in member's bots, chats, integrations, connections, " +
        "routines, workflows, memories, instructions, wiki and tasks. Bots shared with the team are listed with canEdit=false.",
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
    "list_memories",
    { title: "List memories", description: "What the member's bots remember.", ...READ },
    () => run(() => features.listMemories(actor)),
  );

  server.registerTool(
    "list_instructions",
    {
      title: "List instructions",
      description: "Standing instructions for the member's bots.",
      ...READ,
    },
    () => run(() => features.listInstructions(actor)),
  );

  server.registerTool(
    "list_tasks",
    { title: "List tasks", description: "The member's tasks.", ...READ },
    () => run(() => tasks.list(actor)),
  );

  server.registerTool(
    "search_wiki",
    {
      title: "Search wiki",
      description:
        "Search the member's wiki pages, or list them (with pages shared with the installation) when `query` is empty.",
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
      title: "Read wiki page",
      description: "One wiki page by slug.",
      inputSchema: z.object({ slug: z.string().trim().min(1).max(WIKI_LIMITS.slug) }),
      ...READ,
    },
    ({ slug }) =>
      run(async () => {
        const r = await wiki.read(actor.userId, slug);
        if (!r) throw new WikiError("NOT_FOUND");
        const { embedding: _, ...page } = r.page;
        return { access: r.access, page, linkedFrom: r.linkedFrom };
      }),
  );

  return server;
}
