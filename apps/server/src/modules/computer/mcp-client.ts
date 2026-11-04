import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { ComputerError } from "./service";

/** One MCP tool call on a desktop driver (cua-driver, agent-desktop), whatever the transport. */
export type McpCall = (
  tool: string,
  args: Record<string, unknown>,
  opts?: { signal?: AbortSignal | undefined; timeout?: number },
) => Promise<{
  text: string;
  imageBase64?: string;
  isError: boolean;
  /** The tool's structuredContent, when it returns one. */ structured?: unknown;
}>;
export type McpSession = { call: McpCall; close: () => Promise<void> };
/** `attempts` bounds the health wait (250 ms apart): a reattach to a container that should already be up gives up quickly. */
export type VmConnect = (port: number, token: string, attempts?: number) => Promise<McpSession>;

/** Wraps a connected MCP client: a slow step or a Stop is not a dead connection, so it keeps the session and tells the caller what happened. */
export function wrapClient(c: Client): McpSession {
  return {
    call: async (tool, args, opts) => {
      const r = (await c
        .callTool({ name: tool, arguments: args }, undefined, {
          timeout: opts?.timeout ?? 60_000,
          ...(opts?.signal ? { signal: opts.signal } : {}),
        })
        .catch((e: unknown) => {
          if (opts?.signal?.aborted) throw new ComputerError("CANCELLED");
          if (
            (e as { code?: unknown })?.code === -32001 ||
            /timed? ?out/i.test(String((e as Error)?.message))
          )
            throw new ComputerError("SLOW");
          throw e;
        })) as {
        isError?: boolean;
        content?: { type: string; text?: string; data?: string }[];
        structuredContent?: unknown;
      };
      return {
        text: (r.content ?? [])
          .filter((x) => x.type === "text")
          .map((x) => x.text ?? "")
          .join("\n"),
        imageBase64: r.content?.find((x) => x.type === "image")?.data,
        isError: Boolean(r.isError),
        structured: r.structuredContent,
      };
    },
    close: () => c.close().catch(() => {}),
  };
}

/** Production transport: spacesd's MCP endpoint, bearer token in a header (never in a URL), after its health check answers. */
export const connectSpacesd: VmConnect = async (port, token, attempts = 240) => {
  const base = `http://127.0.0.1:${port}`;
  const headers = { authorization: `Bearer ${token}` };
  let ok = false;
  for (let i = 0; i < attempts && !ok; i++) {
    ok = await fetch(`${base}/health`, { headers }).then(
      (r) => r.ok,
      () => false,
    );
    if (!ok) await Bun.sleep(250);
  }
  if (!ok) throw new ComputerError("UNAVAILABLE");
  const c = new Client({ name: "zetta-vm", version: "1" });
  await c.connect(
    new StreamableHTTPClientTransport(new URL(`${base}/mcp`), { requestInit: { headers } }),
  );
  return wrapClient(c);
};
