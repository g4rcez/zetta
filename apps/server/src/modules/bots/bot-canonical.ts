import { createHash } from "node:crypto";
import { z } from "zod";
import { BotContractError, parseBotDefinition, parseBotBinding, parseBotMutation, type BotDefinition, type BotBinding, type BotMutation } from "./bot-contract";

export function canonicalBotDefinition(raw: unknown): string { return JSON.stringify(["zetta.bot.definition", 1, parseBotDefinition(raw)]); }
export function canonicalBotBinding(raw: unknown): string { return JSON.stringify(["zetta.bot.binding", 1, parseBotBinding(raw)]); }
export function canonicalBotMutation(raw: unknown): string { return JSON.stringify(["zetta.bot.mutation", 1, parseBotMutation(raw)]); }
export function fingerprintBotDefinition(raw: unknown): string { return createHash("sha256").update(canonicalBotDefinition(raw), "utf8").digest("hex"); }
export function fingerprintBotBinding(raw: unknown): string { return createHash("sha256").update(canonicalBotBinding(raw), "utf8").digest("hex"); }
function payload(raw: unknown, tag: string, maxBytes: number, code: BotContractError["code"]): unknown {
  if (typeof raw !== "string" || raw.length > maxBytes || !raw.isWellFormed() || Buffer.byteLength(raw, "utf8") > maxBytes) throw new BotContractError(code);
  let json: unknown;
  try { json = JSON.parse(raw); } catch (error) {
    if (error instanceof SyntaxError) throw new BotContractError(code);
    throw error;
  }
  const parsed = z.tuple([z.literal(tag), z.literal(1), z.unknown()]).safeParse(json);
  if (!parsed.success) throw new BotContractError(code);
  return parsed.data[2];
}
export function decodeBotDefinition(raw: unknown): BotDefinition {
  const value = parseBotDefinition(payload(raw, "zetta.bot.definition", 32768, "invalid_definition"));
  if (canonicalBotDefinition(value) !== raw) throw new BotContractError("invalid_definition");
  return value;
}
export function decodeBotBinding(raw: unknown): BotBinding {
  const value = parseBotBinding(payload(raw, "zetta.bot.binding", 16384, "invalid_binding"));
  if (canonicalBotBinding(value) !== raw) throw new BotContractError("invalid_binding");
  return value;
}
export function decodeBotMutation(raw: unknown): BotMutation {
  const value = parseBotMutation(payload(raw, "zetta.bot.mutation", 40960, "invalid_mutation"));
  if (canonicalBotMutation(value) !== raw) throw new BotContractError("invalid_mutation");
  return value;
}
