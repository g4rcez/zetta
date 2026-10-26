import { z } from "zod";
import { LaunchSpecError, parseStoredLaunchSpec } from "./launch-spec";
import type { LaunchSpec } from "./launch-spec";

const context = z.tuple([z.string(), z.string(), z.string(), z.string(), z.string(), z.string(), z.string().nullable(), z.string().nullable()]);
const tuple = z.tuple([z.literal("zetta.launch.spec"), z.literal(1), context, z.string(), z.number(), z.string(), z.string(), z.string(), z.number(),
  z.tuple([z.number(), z.number(), z.number(), z.number()])]);
function encode(spec: LaunchSpec): string {
  const c = spec.context, b = spec.budgets;
  return JSON.stringify(["zetta.launch.spec", 1, [c.actorId, c.runId, c.attemptId, c.botId, c.conversationId, c.configurationId, c.routineId ?? null, c.delegationId ?? null],
    spec.leaseId, spec.fence, spec.recipe, spec.fixtureCase, spec.policyVersion, spec.deadlineEpochMs, [b.deadlineMs, b.maxInputBytes, b.maxOutputBytes, b.maxFrameBytes]]);
}
/** Historical bytes only: callers must separately perform fresh admission and producer checks. */
export function canonicalDispatchLaunchSpec(raw: unknown): string {
  const text = encode(parseStoredLaunchSpec(raw));
  if (Buffer.byteLength(text, "utf8") > 16384) throw new LaunchSpecError("invalid_spec");
  return text;
}
export function decodeDispatchLaunchSpec(raw: unknown): LaunchSpec {
  if (typeof raw !== "string" || !raw.isWellFormed() || raw.includes("\0") || Buffer.byteLength(raw, "utf8") > 16384) throw new LaunchSpecError("invalid_spec");
  let json: unknown;
  try { json = JSON.parse(raw); } catch (error) { if (error instanceof SyntaxError) throw new LaunchSpecError("invalid_spec"); throw error; }
  const parsed = tuple.safeParse(json);
  if (!parsed.success) throw new LaunchSpecError("invalid_spec");
  const [, version, c, leaseId, fence, recipe, fixtureCase, policyVersion, deadlineEpochMs, b] = parsed.data;
  const spec = parseStoredLaunchSpec({ version, context: { actorId: c[0], runId: c[1], attemptId: c[2], botId: c[3], conversationId: c[4], configurationId: c[5],
    ...(c[6] === null ? {} : { routineId: c[6] }), ...(c[7] === null ? {} : { delegationId: c[7] }) },
    leaseId, fence, recipe, fixtureCase, policyVersion, deadlineEpochMs, budgets: { deadlineMs: b[0], maxInputBytes: b[1], maxOutputBytes: b[2], maxFrameBytes: b[3] } });
  if (encode(spec) !== raw) throw new LaunchSpecError("invalid_spec");
  return spec;
}
