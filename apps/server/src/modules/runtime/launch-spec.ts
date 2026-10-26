import { createHash } from "node:crypto";
import { z } from "zod";
import { runContextSchema } from "./harness";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const positiveInteger = z.number().int().min(1).max(Number.MAX_SAFE_INTEGER);
const budgetsSchema = z.strictObject({
  deadlineMs: positiveInteger.max(60_000), maxInputBytes: positiveInteger.max(65_536),
  maxOutputBytes: positiveInteger.max(65_536), maxFrameBytes: positiveInteger.max(8_192),
}).refine((value) => value.maxFrameBytes <= Math.min(value.maxInputBytes, value.maxOutputBytes)).readonly();
const specSchema = z.strictObject({
  version: z.literal(1), context: runContextSchema, leaseId: id.brand<"LaunchLeaseId">(), fence: positiveInteger,
  recipe: z.literal("fixture-v1"), fixtureCase: z.enum(["echo", "wait", "fork", "term-resistant", "flood"]),
  policyVersion: id, deadlineEpochMs: positiveInteger, budgets: budgetsSchema,
}).readonly().brand<"LaunchSpec">();
const admissionSchema = z.strictObject({
  nowEpochMs: positiveInteger, authorizedDeadlineEpochMs: positiveInteger, policyVersion: id,
}).readonly();

export type LaunchSpec = z.infer<typeof specSchema>;
export type LaunchAdmission = z.infer<typeof admissionSchema>;
export class LaunchSpecError extends Error {
  readonly name = "LaunchSpecError";
  constructor(readonly code: "invalid_spec" | "invalid_admission" | "unsupported_policy" | "deadline_denied" | "invalid_policy") { super(code); }
}

// Historical shape parsing confers no launch admission; dispatch must use parseLaunchSpec.
export function parseStoredLaunchSpec(raw: unknown): LaunchSpec {
  const parsed = specSchema.safeParse(raw);
  if (!parsed.success) throw new LaunchSpecError("invalid_spec");
  return parsed.data;
}

export function parseLaunchSpec(raw: unknown, admission: LaunchAdmission): LaunchSpec {
  const trusted = admissionSchema.safeParse(admission);
  if (!trusted.success) throw new LaunchSpecError("invalid_admission");
  const spec = parseStoredLaunchSpec(raw);
  if (spec.policyVersion !== trusted.data.policyVersion) throw new LaunchSpecError("unsupported_policy");
  const remaining = spec.deadlineEpochMs - trusted.data.nowEpochMs;
  if (remaining <= 0 || remaining > spec.budgets.deadlineMs || remaining > 60_000
    || spec.deadlineEpochMs > trusted.data.authorizedDeadlineEpochMs) throw new LaunchSpecError("deadline_denied");
  return spec;
}

export function digestLaunchSpec(spec: LaunchSpec): string {
  const context = spec.context, budgets = spec.budgets;
  const tuple = ["zetta.launch.spec", spec.version,
    [context.actorId, context.runId, context.attemptId, context.botId, context.conversationId, context.configurationId, context.routineId ?? null, context.delegationId ?? null],
    spec.leaseId, spec.fence, spec.recipe, spec.fixtureCase, spec.policyVersion, spec.deadlineEpochMs,
    [budgets.deadlineMs, budgets.maxInputBytes, budgets.maxOutputBytes, budgets.maxFrameBytes],
  ];
  return createHash("sha256").update(JSON.stringify(tuple), "utf8").digest("hex");
}
