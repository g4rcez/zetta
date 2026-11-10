import { isRecord } from "@zetta/core/is-record";
import type {
  AppApproval,
  AppApprovalCondition,
  AppToolKind,
  AppToolPolicy,
} from "@zetta/db/schema/apps";

/**
 * What happens to a call before it runs: `run` (no one is asked), `ask` (a card the person answers first) or `deny` (it never runs).
 *
 * Order of authority: the owner's choice for the tool (`block`, `ask`, `auto`) > what the tool declares (`always`, `never`, or `when` its
 * input matches) > the default by kind (a query runs, a mutation asks). Whoever wrote the code can never loosen what the owner set.
 * Outside people (an inbound chat) may only run queries that need no one's answer: the rest is denied, whatever the owner chose.
 */
export type Decision = { decision: "run" | "ask" | "deny"; reason: string };

/** The value at a dotted path (`repo.private`, `labels.0`), or undefined. */
export function at(input: unknown, path: string): unknown {
  let cur: unknown = input;
  for (const part of path.split(".")) {
    if (Array.isArray(cur)) cur = cur[Number(part)];
    else if (isRecord(cur)) cur = Object.hasOwn(cur, part) ? cur[part] : undefined;
    else return undefined;
  }
  return cur;
}

/** One condition of `approval: { when }` against the (validated) input. */
export function conditionHolds(c: AppApprovalCondition, input: unknown): boolean {
  const v = at(input, c.path);
  switch (c.op) {
    case "exists":
      return v !== undefined && v !== null;
    case "eq":
      return JSON.stringify(v) === JSON.stringify(c.value);
    case "neq":
      return JSON.stringify(v) !== JSON.stringify(c.value);
    case "gt":
      return typeof v === "number" && typeof c.value === "number" && v > c.value;
    case "lt":
      return typeof v === "number" && typeof c.value === "number" && v < c.value;
    case "contains":
      if (typeof v === "string") return typeof c.value === "string" && v.includes(c.value);
      if (Array.isArray(v)) return v.some((x) => JSON.stringify(x) === JSON.stringify(c.value));
      return false;
  }
}

/** The rules a manifest may declare: checked at publish so a policy never silently fails to compile later. */
export function approvalProblem(a: unknown): string | null {
  if (a === undefined || a === "always" || a === "never") return null;
  if (!isRecord(a) || !Array.isArray(a.when) || a.when.length === 0 || a.when.length > 10)
    return 'approval must be "always", "never" or { when: [1 to 10 conditions] }.';
  for (const c of a.when as unknown[]) {
    if (!isRecord(c) || typeof c.path !== "string" || !/^[A-Za-z0-9_.-]{1,100}$/.test(c.path))
      return "an approval condition needs a path such as repo.private.";
    if (!["eq", "neq", "gt", "lt", "contains", "exists"].includes(String(c.op)))
      return `an approval condition has an unknown operator "${String(c.op)}".`;
  }
  return null;
}

export function decide(o: {
  kind: AppToolKind;
  approval?: AppApproval | undefined;
  /** The owner's choice for this tool, if any. */
  override?: AppToolPolicy | undefined;
  input: unknown;
  /** The call comes from an inbound conversation: someone outside the account. */
  outside?: boolean;
}): Decision {
  const base = ((): Decision => {
    if (o.override === "block") return { decision: "deny", reason: "The owner blocked this tool." };
    if (o.override === "ask")
      return { decision: "ask", reason: "The owner asked to approve every call." };
    if (o.override === "auto")
      return { decision: "run", reason: "The owner lets this tool run without asking." };
    const a = o.approval;
    if (a === "always") return { decision: "ask", reason: "The tool asks for approval." };
    if (a === "never") return { decision: "run", reason: "The tool needs no approval." };
    if (a && typeof a === "object")
      return a.when.every((c) => conditionHolds(c, o.input))
        ? { decision: "ask", reason: "This input needs approval." }
        : { decision: "run", reason: "This input needs no approval." };
    return o.kind === "mutation"
      ? { decision: "ask", reason: "A tool that changes something asks first." }
      : { decision: "run", reason: "A tool that only reads needs no approval." };
  })();
  if (o.outside && !(o.kind === "query" && base.decision === "run"))
    return {
      decision: "deny",
      reason: "People outside your account may only use tools that read and need no approval.",
    };
  return base;
}

/** One line for a card or a list: how this tool is guarded. */
export function describePolicy(
  kind: AppToolKind,
  approval?: AppApproval,
  override?: AppToolPolicy,
): string {
  if (override === "block") return "Blocked";
  if (override === "ask") return "Always asks";
  if (override === "auto") return "Never asks";
  if (approval === "always") return "Always asks";
  if (approval === "never") return "Never asks";
  if (approval && typeof approval === "object") return "Asks for some inputs";
  return kind === "mutation" ? "Asks (changes something)" : "Never asks (reads)";
}
