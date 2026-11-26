import type { Database } from "@zetta/db";
import { and, eq } from "@zetta/db/query";
import { bot } from "@zetta/db/schema/chat";
import type { z } from "zod";
import { firstObject } from "./bot-interview";
import { HarnessError, harnessMessage, runCli, type NativeHarness, type RunCli } from "./harness";
import { chiefFor } from "../workspaces/chief";

export type OneShotResult<T> = { kind: "ok"; value: T } | { kind: "unavailable"; reason: string };

/**
 * One question to the person's chief engine, answered as one JSON object: no chat, no tools, nothing saved. Callers frame every piece of
 * outside text as data and check the answer against a schema; an answer that does not fit is asked for once more, then given up.
 */
export function createOneShot(db: Pick<Database, "select">, deps: { cli?: RunCli } = {}) {
  const cli = deps.cli ?? runCli;
  return async function ask<S extends z.ZodType>(
    owner: string,
    prompt: string,
    schema: S,
    timeoutMs = 60_000,
    /** Run on this bot's own engine (it must be the owner's) instead of the chief's. */
    useBot?: string,
  ): Promise<OneShotResult<z.infer<S>>> {
    const chief = useBot
      ? (
          await db
            .select()
            .from(bot)
            .where(and(eq(bot.ownerUserId, owner), eq(bot.id, useBot), eq(bot.archived, false)))
            .limit(1)
        )[0]
      : await chiefFor(db, owner);
    if (!chief)
      return {
        kind: "unavailable",
        reason: useBot ? "That bot is not available." : "This needs a chief bot. Create one first.",
      };
    if (chief.harness === "fixture" || chief.harness === "decision")
      return {
        kind: "unavailable",
        reason: "Your chief uses a practice or routing engine that cannot write this.",
      };
    for (let attempt = 0; attempt < 2; attempt++) {
      let out: string;
      try {
        out = await cli({
          harness: chief.harness as NativeHarness,
          prompt,
          model: chief.model ?? null,
          userId: owner,
          timeoutMs,
        });
      } catch (e) {
        return {
          kind: "unavailable",
          reason:
            e instanceof HarnessError
              ? harnessMessage(chief.harness as NativeHarness, e.code)
              : "The engine could not answer. Try again.",
        };
      }
      const raw = firstObject(out);
      const parsed = schema.safeParse(raw);
      if (raw !== undefined && parsed.success) return { kind: "ok", value: parsed.data };
    }
    return { kind: "unavailable", reason: "The engine gave an answer that could not be read." };
  };
}
export type OneShot = ReturnType<typeof createOneShot>;

/** Everything between the tags is data: a `<` inside it cannot close the tag. */
export const dataBlock = (label: string, text: string) =>
  `<${label}>\n${text.replaceAll("<", "‹")}\n</${label}>`;
