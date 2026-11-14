import { describe, expect, it } from "bun:test";
import {
  ACTIONS,
  ATTENTION_KINDS,
  DECISION_KINDS,
  FYI_KINDS,
  QUEUE_KINDS,
  categoryOf,
  isAttentionKind,
  isDecisionKind,
  notifyOf,
} from "./attention-kinds";

describe("attention kinds", () => {
  it("lists every kind once", () => {
    expect(new Set(ATTENTION_KINDS).size).toBe(ATTENTION_KINDS.length);
  });

  it("gives every decision kind an act, a deny and a label for each", () => {
    for (const kind of DECISION_KINDS) {
      const x = ACTIONS[kind];
      expect(x.actLabel.length).toBeGreaterThan(0);
      expect(x.denyLabel.length).toBeGreaterThan(0);
    }
    expect(Object.keys(ACTIONS).sort()).toEqual([...DECISION_KINDS].sort());
  });

  it("derives the category from the kind", () => {
    for (const k of DECISION_KINDS) expect(categoryOf(k)).toBe("decision");
    for (const k of FYI_KINDS) expect(categoryOf(k)).toBe("fyi");
  });

  it("keeps the legacy proposal cards out of the queue", () => {
    expect(QUEUE_KINDS).not.toContain("proposal");
    expect(QUEUE_KINDS.length).toBe(DECISION_KINDS.length - 1);
  });

  it("notifies for every decision and only for agenda reminders among the updates", () => {
    for (const k of DECISION_KINDS) expect(notifyOf(k)).toBe("native");
    expect(FYI_KINDS.filter((k) => notifyOf(k) === "native")).toEqual(["agenda_reminder"]);
  });

  it("recognises kinds and rejects anything else", () => {
    expect(isAttentionKind("loop_paused")).toBe(true);
    expect(isAttentionKind("nope")).toBe(false);
    expect(isAttentionKind(3)).toBe(false);
    expect(isDecisionKind("room_idle")).toBe(false);
  });
});
