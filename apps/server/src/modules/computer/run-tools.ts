import { randomBytes, timingSafeEqual } from "node:crypto";

import { createMcpHandler, McpServer, type CallToolResult } from "@modelcontextprotocol/server";
import { Elysia } from "elysia";
import { z } from "zod";

import type { VmAction } from "./drivers/types";

/**
 * The computer as tools INSIDE a Claude Code run. With the fenced `zetta:desktop` blocks every batch of steps ended the CLI run and a
 * new one started, and the bot never saw the screen, only a numbered list. Here the run calls `computer_read`, `computer_act` and
 * `computer_screenshot` (an image) as MCP tools while it works, through this server's own endpoint.
 *
 * Each turn gets a fresh random token that names its user, bot and abort signal; it lives only while the turn runs and is checked in
 * constant time. The tools go through the same VM service as the fenced blocks, so takeover, the public-address check, the epoch rule
 * and the computer limits are unchanged. Harnesses without MCP keep the fenced blocks.
 */
type VmPort = {
  start(userId: string, vmId?: string): Promise<{ id: string; name: string }>;
  epochOf(userId: string, id: string): number;
  act(
    userId: string,
    id: string,
    by: "agent",
    action: VmAction,
    opts?: { signal?: AbortSignal; epoch?: number },
  ): Promise<{ url?: string; loaded?: boolean }>;
  read(
    userId: string,
    id: string,
    opts?: { settle?: boolean; signal?: AbortSignal },
  ): Promise<string>;
  screenshot(userId: string, id: string): Promise<string>;
};
type Grant = {
  userId: string;
  botId: string;
  signal?: AbortSignal | undefined;
  /** Shows the computer in the chat (the same card the fenced blocks raise). */
  onComputer?: ((vm: { id: string; name: string }, step?: string) => void) | undefined;
};

const grants = new Map<string, Grant>();

/** A token for one turn; `revoke` when the turn ends (also done when its signal aborts). */
export function mintRunToken(g: Grant) {
  const token = randomBytes(32).toString("base64url");
  grants.set(token, g);
  const revoke = () => grants.delete(token);
  g.signal?.addEventListener("abort", revoke, { once: true });
  return { token, revoke };
}

function grantOf(header: string | null): Grant | undefined {
  const token = /^Bearer (\S{20,200})$/.exec(header ?? "")?.[1];
  if (!token) return undefined;
  for (const [k, g] of grants) {
    const a = Buffer.from(k),
      b = Buffer.from(token);
    if (a.length === b.length && timingSafeEqual(a, b)) return g;
  }
  return undefined;
}

const text = (t: string): CallToolResult => ({ content: [{ type: "text", text: t }] });
const failure = (e: unknown): CallToolResult => ({
  isError: true,
  content: [
    {
      type: "text",
      text:
        (e as { code?: string }).code === "HUMAN_IN_CONTROL"
          ? "A person is controlling the computer. Wait until they hand it back."
          : `The computer could not do that (${(e as { code?: string }).code ?? "error"}${(e as { detail?: string }).detail ? `: ${(e as { detail?: string }).detail}` : ""}).`,
    },
  ],
});

const action = z.discriminatedUnion("type", [
  z.object({ type: z.literal("navigate"), url: z.string().url().max(2000) }),
  z.object({ type: z.literal("click_element"), n: z.number().int().min(0).max(5000) }),
  z.object({ type: z.literal("click"), x: z.number(), y: z.number() }),
  z.object({ type: z.literal("type"), text: z.string().max(4000) }),
  z.object({ type: z.literal("key"), key: z.string().max(40) }),
  z.object({ type: z.literal("scroll"), direction: z.enum(["up", "down", "left", "right"]) }),
  z.object({ type: z.literal("launch"), app: z.string().max(80) }),
]);

export function computerToolServer(vms: VmPort, g: Grant) {
  const server = new McpServer(
    { name: "zetta-computer", version: "1.0.0" },
    {
      instructions:
        "The user's computer (a VM, a remote computer, or their own desktop on a local install). Read the screen, act, look at a screenshot. Never type passwords: ask the user to take over for sign-ins.",
    },
  );
  const open = async (vm: string | undefined, step: string) => {
    const v = await vms.start(g.userId, vm);
    g.onComputer?.(v, step);
    return v;
  };
  server.registerTool(
    "computer_read",
    {
      title: "Read the screen",
      description:
        "What the computer shows now, as text with clickable elements numbered [n] (use them with computer_act click_element).",
      inputSchema: z.object({ vm: z.string().uuid().optional() }),
    },
    async ({ vm }) => {
      try {
        const v = await open(vm, "read the screen");
        return text((await vms.read(g.userId, v.id, { signal: g.signal })).slice(0, 12_000));
      } catch (e) {
        return failure(e);
      }
    },
  );
  server.registerTool(
    "computer_act",
    {
      title: "Act on the computer",
      description:
        "One step: navigate {url}, click_element {n}, click {x,y}, type {text}, key {key}, scroll {direction}, launch {app}. Returns what the screen shows after it.",
      inputSchema: z.object({ action, vm: z.string().uuid().optional() }),
    },
    async ({ action: a, vm }) => {
      try {
        const v = await open(vm, a.type);
        const at = await vms.act(g.userId, v.id, "agent", a as VmAction, {
          signal: g.signal,
          epoch: vms.epochOf(g.userId, v.id),
        });
        const screen = await vms
          .read(g.userId, v.id, { settle: true, signal: g.signal })
          .catch(() => "(the screen could not be read just now: call computer_read)");
        return text(
          `${a.type} ok${at.url ? `: now at ${at.url}${at.loaded === false ? " (still loading)" : ""}` : ""}\n${screen.slice(0, 8000)}`,
        );
      } catch (e) {
        return failure(e);
      }
    },
  );
  server.registerTool(
    "computer_screenshot",
    {
      title: "Screenshot",
      description:
        "A picture of the screen, when the text of computer_read is not enough (charts, images, layout).",
      inputSchema: z.object({ vm: z.string().uuid().optional() }),
    },
    async ({ vm }) => {
      try {
        const v = await open(vm, "screenshot");
        const png = await vms.screenshot(g.userId, v.id);
        return { content: [{ type: "image", data: png, mimeType: "image/png" }] };
      } catch (e) {
        return failure(e);
      }
    },
  );
  return server;
}

/** POST /api/run-tools/mcp: only a live turn's token is accepted. */
export function createRunToolRoutes(vms: VmPort | undefined) {
  const mcp = createMcpHandler(({ authInfo }) => {
    const g = authInfo?.extra?.grant as Grant | undefined;
    if (!g || !vms) throw new Error("run-tools: request without a live turn");
    return computerToolServer(vms, g);
  });
  return new Elysia().all("/api/run-tools/mcp", ({ request }) => {
    const g = grantOf(request.headers.get("authorization"));
    if (!g || !vms) return Response.json({ error: "unauthorized" }, { status: 401 });
    return mcp.fetch(request, {
      authInfo: { token: "", clientId: "zetta-run", scopes: [], extra: { grant: g } },
    });
  });
}

/** The address the CLI reaches this server at, from the same machine (or the container's host gateway). */
export const runToolsUrl = () =>
  `${(process.env.ZETTA_INTERNAL_URL || `http://127.0.0.1:${process.env.PORT ?? 3000}`).replace(/\/+$/, "")}/api/run-tools/mcp`;
