/**
 * The text of a source file for tests that check what a module does and in which order. The formatter may break a line or add a
 * trailing comma anywhere, so whitespace counts as one space and a wrapped call or object has no trailing comma before its closer.
 */
export const sourceOf = async (file: string) =>
  (await Bun.file(new URL(file, import.meta.url)).text())
    .replace(/\s+/g, " ")
    .replace(/\( /g, "(")
    .replace(/,? \)/g, ")")
    .replace(/, \}/g, " }");
