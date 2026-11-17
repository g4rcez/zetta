import { describe, expect, test } from "bun:test";

import { runBot } from "./bot";
import { chiefSchemas } from "./schemas";
import type { ChiefCtx } from "./types";

const ID = "018f0000-0000-7000-8000-0000000000a1";
const row = {
  id: ID,
  name: "Researcher",
  kind: "specialist",
  harness: "claude",
  model: null,
  visibility: "private",
  computerMode: "off",
  codeAccess: false,
  outputStyle: "default",
  folderId: null,
  version: 3,
  role: "",
  description: "Reads the news\nand summarizes it",
  personality: "",
  instructions: "",
};

// `owned(ctx)` awaits `db.select().from().where().orderBy()`: a chain whose last call resolves to the bot rows is enough.
const chain: Record<string, unknown> = {
  select: () => chain,
  from: () => chain,
  where: () => chain,
  orderBy: async () => [row],
};
const ctx = { actor: { userId: "u1" }, deps: { db: chain } } as unknown as ChiefCtx;

const parse = (args: unknown) => chiefSchemas.bot.parse(args);

describe("the Chief's zetta:bot and the bot role", () => {
  test("an update with a role is a card that shows the role change", async () => {
    const out = await runBot(
      ctx,
      parse({ action: "update", bot: "Researcher", role: "News analyst" }) as never,
    );
    if (!("plan" in out)) throw new Error("expected a plan");
    expect(out.plan.diff.map((d) => d.field)).toEqual(["bot", "role"]);
    expect(out.plan.patch).toMatchObject({
      op: "update",
      botId: ID,
      changes: { role: "News analyst" },
    });
  });

  test("the same role is nothing to change", async () => {
    const out = await runBot(
      ctx,
      parse({ action: "update", bot: "Researcher", role: "" }) as never,
    );
    expect(out).toMatchObject({ error: expect.stringContaining("nothing to change") });
  });

  test("list and get show the role, and the line a picker would draw", async () => {
    const list = await runBot(ctx, parse({ action: "list" }) as never);
    expect("read" in list && list.read).toContain('"role":"Reads the news"');
    const get = await runBot(ctx, parse({ action: "get", bot: "Researcher" }) as never);
    expect("read" in get && get.read).toContain('"role":""');
    expect("read" in get && get.read).toContain('"shownAs":"Reads the news"');
  });
});
