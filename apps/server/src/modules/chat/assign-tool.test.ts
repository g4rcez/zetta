import { describe, expect, test } from "bun:test";
import { parseTools } from "./tools";

const fence = (body: string) => `\`\`\`zetta:assign\n${body}\n\`\`\``;

describe("zetta:assign", () => {
  test("takes a member, a task and what done looks like; details are optional", () => {
    const r = parseTools(
      `Merging now.\n${fence('{"bot":"Dev","task":"Merge PR 74","done_when":"merge SHA on main"}')}`,
    );
    expect(r.rejected).toEqual([]);
    expect(r.text).toBe("Merging now.");
    expect(r.calls).toEqual([
      { kind: "assign", args: { bot: "Dev", task: "Merge PR 74", done_when: "merge SHA on main" } },
    ]);
    const withDetails = parseTools(
      fence('{"bot":"Dev","task":"t","done_when":"d","details":"keep the branch"}'),
    );
    expect(withDetails.calls[0]).toMatchObject({ args: { details: "keep the branch" } });
  });
  test("one block per member: two blocks in a reply are two calls", () => {
    const r = parseTools(
      `${fence('{"bot":"A","task":"t1","done_when":"d1"}')}\n${fence('{"bot":"B","task":"t2","done_when":"d2"}')}`,
    );
    expect(r.calls.map((c) => (c.args as { bot: string }).bot)).toEqual(["A", "B"]);
  });
  test("a block without done_when, or with an unknown field, is rejected with the reason", () => {
    const missing = parseTools(fence('{"bot":"Dev","task":"Merge PR 74"}'));
    expect(missing.calls).toEqual([]);
    expect(missing.rejected[0]).toMatchObject({
      kind: "assign",
      reason: expect.stringContaining("done_when"),
    });
    expect(parseTools(fence('{"bot":"Dev","task":"t","done_when":"d","extra":1}')).calls).toEqual(
      [],
    );
  });
});
