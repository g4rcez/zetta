import {
  createBridgeLimiter,
  errorReply,
  okReply,
  parseBridgeRequest,
  type BridgeReply,
} from "@zetta/core/app-bridge";
import type { CallResult, ToolKind } from "./apps-api";

/**
 * The side of the bridge that lives in the web app. The page of an app runs in a sandboxed frame and can only post messages; this
 * object is what reads them. For every message it: ignores what is not a request, refuses a tool the app does not have, applies the rate
 * limit, calls the server as the person, and answers the page. A call that needs approval is shown to the person by the web app (never by
 * the page) and waits for their answer.
 *
 * No DOM in here, so the whole decision path is tested with plain objects.
 */
export type HostApi = {
  call: (tool: string, input: Record<string, unknown>) => Promise<CallResult>;
  answer: (callId: string, action: "accept" | "decline" | "cancel") => Promise<CallResult>;
};
/** A change the person is asked to allow. `allow(remember)` runs it; `refuse()` stops it. */
export type Prompt = {
  callId: string;
  tool: string;
  kind: ToolKind;
  input: unknown;
  reason: string;
  allow: (remember: boolean) => void;
  refuse: () => void;
};

const messageOf = (e: unknown) => (e instanceof Error ? e.message : "The call failed.");
const codeOf = (e: unknown) =>
  typeof (e as { code?: unknown })?.code === "string" ? (e as { code: string }).code : "FAILED";

export function createAppHost(o: {
  tools: readonly { name: string }[];
  api: HostApi;
  /** Sends an answer to the page. */
  reply: (r: BridgeReply) => void;
  /** Called with the current list of prompts whenever it changes. */
  onPrompts: (prompts: readonly Prompt[]) => void;
  now?: () => number;
}) {
  const allowed = new Set(o.tools.map((t) => t.name));
  const limiter = createBridgeLimiter(o.now);
  /** Tools the person allowed for as long as this page is open. */
  const granted = new Set<string>();
  let prompts: Prompt[] = [];
  let disposed = false;
  const setPrompts = (next: Prompt[]) => {
    prompts = next;
    o.onPrompts(prompts);
  };

  /** Shows a prompt and waits for the person. */
  const ask = (r: Extract<CallResult, { status: "approval_required" }>) =>
    new Promise<{ allow: boolean; remember: boolean }>((resolve) => {
      const done = (allow: boolean, remember: boolean) => {
        setPrompts(prompts.filter((p) => p !== prompt));
        resolve({ allow, remember });
      };
      const prompt: Prompt = {
        callId: r.callId,
        tool: r.tool,
        kind: r.kind,
        input: r.input,
        reason: r.reason,
        allow: (remember) => done(true, remember),
        refuse: () => done(false, false),
      };
      if (disposed) return resolve({ allow: false, remember: false });
      setPrompts([...prompts, prompt]);
    });

  const answerOf = (id: number, r: CallResult): BridgeReply => {
    if (r.status === "ok") return okReply(id, r.value);
    if (r.status === "failed") return errorReply(id, r.error.code, r.error.message);
    if (r.status === "denied") return errorReply(id, "DENIED", r.reason);
    return errorReply(id, "FAILED", "The call could not be finished.");
  };

  async function run(id: number, tool: string, input: Record<string, unknown>) {
    let r = await o.api.call(tool, input);
    if (r.status !== "approval_required") return answerOf(id, r);
    if (granted.has(tool)) return answerOf(id, await o.api.answer(r.callId, "accept"));
    const choice = await ask(r);
    if (!choice.allow) {
      // Close the call on the server so it does not wait for an answer that will not come.
      await o.api.answer(r.callId, disposed ? "cancel" : "decline").catch(() => undefined);
      return errorReply(id, "DECLINED", "The person declined this change.");
    }
    if (choice.remember) granted.add(tool);
    r = await o.api.answer(r.callId, "accept");
    return answerOf(id, r);
  }

  return {
    /** Handles one message that arrived from the page's frame. The caller has already checked that it came from that frame. */
    async handle(data: unknown) {
      const parsed = parseBridgeRequest(data, allowed);
      if (parsed.kind === "ignore") return;
      if (parsed.kind === "reject") return o.reply(parsed.reply);
      const { id, tool, input } = parsed.request;
      const limited = limiter.start(id);
      if (limited) return o.reply(limited);
      try {
        o.reply(await run(id, tool, input ?? {}));
      } catch (e) {
        o.reply(errorReply(id, codeOf(e), messageOf(e)));
      } finally {
        limiter.done();
      }
    },
    /** The page was closed: every prompt that is still open is refused, so the calls behind them are closed on the server. */
    dispose() {
      disposed = true;
      for (const p of prompts) p.refuse();
    },
  };
}
