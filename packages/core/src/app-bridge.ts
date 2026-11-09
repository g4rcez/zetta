/**
 * The bridge between an app's page and the app that shows it.
 *
 * The page runs in an iframe with an opaque origin (`sandbox="allow-scripts"`, no same-origin), so it cannot reach the API: it has no
 * cookies and the server refuses a request that says `Origin: null`. It can only `postMessage` its parent. The parent (the web app) reads
 * each message with `parseBridgeRequest`, checks it against the tools of that app's version, rate limits it, and makes the API call with the
 * person's own session. Whatever the page sends is untrusted input: everything is checked here, none of it is believed.
 *
 * Pure and free of DOM types, so the server tests the page script and the web tests the host with the same code.
 */
export const BRIDGE_FROM_FRAME = "zetta-app";
export const BRIDGE_FROM_HOST = "zetta-host";
export const BRIDGE_LIMITS = {
  /** Calls a page may have waiting at once. */
  inFlight: 8,
  /** Calls a page may start in one second. */
  perSecond: 20,
  /** JSON characters of one call's input. */
  inputChars: 100_000,
  /** JSON characters of one answer sent back to the page. */
  valueChars: 1_000_000,
  /** How long the page waits for an answer, in milliseconds. A person may be deciding on a prompt, so it is long. */
  waitMs: 10 * 60_000,
} as const;

export type BridgeRequest = {
  source: typeof BRIDGE_FROM_FRAME;
  id: number;
  type: "call";
  tool: string;
  input?: Record<string, unknown>;
};
export type BridgeReply =
  | { source: typeof BRIDGE_FROM_HOST; id: number; ok: true; value: unknown }
  | {
      source: typeof BRIDGE_FROM_HOST;
      id: number;
      ok: false;
      error: { code: string; message: string };
    };

export const okReply = (id: number, value: unknown): BridgeReply => {
  let text: string | undefined;
  try {
    text = JSON.stringify(value ?? null);
  } catch {
    text = undefined;
  }
  if (text === undefined || text.length > BRIDGE_LIMITS.valueChars)
    return errorReply(id, "TOO_LARGE", "The answer is too large to hand to the page.");
  return { source: BRIDGE_FROM_HOST, id, ok: true, value: value ?? null };
};
export const errorReply = (id: number, code: string, message: string): BridgeReply => ({
  source: BRIDGE_FROM_HOST,
  id,
  ok: false,
  error: { code, message: message.slice(0, 500) },
});

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === "object" && v !== null && !Array.isArray(v);

/**
 * Reads a message that came from the page. `ignore`: not ours or not shaped like a request, so nothing is answered (a page, or any other
 * script, may post anything to its parent). `reject`: a request we can answer with an error, because it names an id.
 */
export function parseBridgeRequest(
  data: unknown,
  tools: ReadonlySet<string>,
):
  | { kind: "request"; request: BridgeRequest }
  | { kind: "ignore" }
  | { kind: "reject"; reply: BridgeReply } {
  if (!isRecord(data) || data.source !== BRIDGE_FROM_FRAME || data.type !== "call")
    return { kind: "ignore" };
  const id = data.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1 || id > 2_147_483_647)
    return { kind: "ignore" };
  const tool = data.tool;
  if (typeof tool !== "string" || tool.length > 200)
    return {
      kind: "reject",
      reply: errorReply(id, "UNKNOWN_TOOL", "That is not a tool of this app."),
    };
  if (!tools.has(tool))
    return {
      kind: "reject",
      reply: errorReply(id, "UNKNOWN_TOOL", `This app has no tool called ${tool.slice(0, 80)}.`),
    };
  const input = data.input;
  if (input !== undefined && !isRecord(input))
    return {
      kind: "reject",
      reply: errorReply(id, "INVALID", "The input of a call must be an object."),
    };
  let size = 0;
  try {
    size = JSON.stringify(input ?? {}).length;
  } catch {
    return { kind: "reject", reply: errorReply(id, "INVALID", "The input could not be read.") };
  }
  if (size > BRIDGE_LIMITS.inputChars)
    return {
      kind: "reject",
      reply: errorReply(id, "TOO_LARGE", "The input of this call is too large."),
    };
  return {
    kind: "request",
    request: { source: BRIDGE_FROM_FRAME, id, type: "call", tool, ...(input && { input }) },
  };
}

/** Keeps a page from flooding the API: a few calls at a time and a few per second. `start` returns an error reply or null to go ahead. */
export function createBridgeLimiter(now: () => number = Date.now) {
  let waiting = 0;
  let recent: number[] = [];
  return {
    start(id: number): BridgeReply | null {
      const t = now();
      recent = recent.filter((x) => t - x < 1000);
      if (waiting >= BRIDGE_LIMITS.inFlight || recent.length >= BRIDGE_LIMITS.perSecond)
        return errorReply(id, "RATE_LIMITED", "This page is calling too fast. Slow down.");
      waiting++;
      recent.push(t);
      return null;
    },
    done() {
      waiting = Math.max(0, waiting - 1);
    },
  };
}

/**
 * The script that goes first in the page. It gives the page `window.zetta`:
 *   zetta.call(tool, input) -> Promise of the tool's value; rejects with an Error that has `.code`.
 * and nothing else. No template literals or `${` here: this is built with plain strings so no value can break out of the script.
 */
export function bridgePrelude(): string {
  const lines = [
    "(function () {",
    "  var pending = {};",
    "  var next = 1;",
    `  var WAIT = ${BRIDGE_LIMITS.waitMs};`,
    "  function fail(code, message) { var e = new Error(message); e.code = code; return e; }",
    "  var api = {",
    "    call: function (tool, input) {",
    "      return new Promise(function (resolve, reject) {",
    "        var id = next++;",
    "        var timer = setTimeout(function () {",
    "          if (pending[id]) { delete pending[id]; reject(fail('TIMEOUT', 'No answer came back.')); }",
    "        }, WAIT);",
    "        pending[id] = { resolve: resolve, reject: reject, timer: timer };",
    "        try {",
    `          parent.postMessage({ source: '${BRIDGE_FROM_FRAME}', id: id, type: 'call', tool: tool, input: input }, '*');`,
    "        } catch (e) {",
    "          clearTimeout(timer); delete pending[id]; reject(fail('INVALID', 'The call could not be sent.'));",
    "        }",
    "      });",
    "    }",
    "  };",
    "  Object.defineProperty(window, 'zetta', { value: Object.freeze(api), writable: false, configurable: false });",
    "  addEventListener('message', function (e) {",
    "    if (e.source !== parent) return;",
    "    var d = e.data;",
    `    if (!d || d.source !== '${BRIDGE_FROM_HOST}' || typeof d.id !== 'number') return;`,
    "    var p = pending[d.id];",
    "    if (!p) return;",
    "    delete pending[d.id];",
    "    clearTimeout(p.timer);",
    "    if (d.ok) p.resolve(d.value);",
    "    else p.reject(fail((d.error && d.error.code) || 'FAILED', (d.error && d.error.message) || 'The call failed.'));",
    "  });",
    "})();",
  ];
  return `<script>${lines.join("\n")}</script>`;
}
