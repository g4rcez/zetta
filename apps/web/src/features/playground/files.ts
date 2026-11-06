import type { PlaygroundFile } from "./playground-api";

/** The same rules as the server (`FILE_PATH`); the server decides, this only saves a round trip. */
export function pathProblem(
  path: string,
  existing: readonly { path: string }[],
): string | undefined {
  if (existing.some((f) => f.path === path)) return `${path} is already a file.`;
  if (path.length > 300) return "The path is longer than 300 characters.";
  if (path.startsWith("/") || path.split("/").some((s) => s === "" || s === "." || s === ".."))
    return "Use a relative path without `..`.";
  if (path === "out" || path.startsWith("out/")) return "`out/` holds the files a script writes.";
  if (path === "inputs.json") return "`inputs.json` holds the inputs of a run.";
  return undefined;
}

/**
 * Renames a file. The entry follows its file. Imports in other files are not changed: the person edits them.
 * Returns the sentence that says why the new path is not allowed, or the new files and entry.
 */
export function renameFile(
  draft: { files: PlaygroundFile[]; entry: string },
  from: string,
  to: string,
): { problem: string } | { files: PlaygroundFile[]; entry: string } {
  const problem = pathProblem(
    to,
    draft.files.filter((f) => f.path !== from),
  );
  if (problem) return { problem };
  return {
    files: draft.files.map((f) => (f.path === from ? { ...f, path: to } : f)),
    entry: draft.entry === from ? to : draft.entry,
  };
}
