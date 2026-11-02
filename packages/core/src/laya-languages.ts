/** Languages the builtin Laya decision model must understand, as BCP-47 tags such as `pt-BR`. English is always included. */
export type LayaModel = "english" | "multilingual";

const TAG = /^[a-z]{2,3}(-[A-Z]{2})?$/;
export const isLayaTag = (value: unknown): value is string =>
  typeof value === "string" && TAG.test(value);

/** Only English asks for the English model (about 1.7 GB). Any other language needs the multilingual model, which also reads English. */
export const layaModelFor = (languages: readonly string[]): LayaModel =>
  languages.every((l) => l.split("-")[0] === "en") ? "english" : "multilingual";

/** Valid tags only, no duplicates, English first. Anything else is dropped. */
export function normalizeLayaLanguages(tags: readonly unknown[]): string[] {
  const valid = tags.filter(isLayaTag);
  return [...new Set(["en", ...valid.filter((t) => t !== "en")])];
}
