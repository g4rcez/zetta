import { lstat, readdir, realpath } from "node:fs/promises";
import { join, relative, resolve, sep } from "node:path";
import { classify } from "../artifacts/storage";
import { folderInside, readInside, writeInside } from "../fs-inside";
import { PLAYGROUND_LIMITS } from "./languages";
import { PlaygroundError, type RunOutputFile, type RunResult, type RunSpec } from "./types";

export const GRACE_MS = 2000;
const MAX_DEPTH = 8;

/** Keeps the last `max` bytes of a stream. The partial text stays readable even when a stray process keeps the pipe open. */
export function tail(stream: ReadableStream<Uint8Array> | null | undefined, max: number) {
  let buf: Buffer = Buffer.alloc(0);
  let cut = false;
  const done = (async () => {
    if (!stream) return;
    for await (const chunk of stream as unknown as AsyncIterable<Uint8Array>) {
      buf = Buffer.concat([buf, chunk]);
      if (buf.length > max) {
        buf = buf.subarray(buf.length - max);
        cut = true;
      }
    }
  })().catch(() => {});
  // A NUL byte cannot go into a Postgres text column.
  return { done, text: () => buf.toString("utf8").replaceAll("\0", ""), cut: () => cut };
}

/**
 * Writes the snapshot, `inputs.json` and an empty `out/` into `dir`. A path that leaves the folder is refused, even though the
 * service checked it. `base` is the folder only the server can replace that holds `dir`: the container runner passes its mounted
 * runs folder, where another script may plant a link, and no link under it is followed.
 */
export async function writeFolder(
  dir: string,
  spec: Pick<RunSpec, "files" | "inputs">,
  base = dir,
) {
  const put = (path: string, content: string) =>
    writeInside(base, relative(base, path), content, 0o644);
  for (const f of spec.files) {
    const target = resolve(dir, f.path);
    if (!target.startsWith(dir + sep))
      throw new PlaygroundError("INVALID", "A file path leaves the folder.");
    await put(target, f.content);
  }
  await put(join(dir, "inputs.json"), JSON.stringify(spec.inputs));
  await folderInside(base, relative(base, join(dir, "out")));
}

/**
 * The regular files under `base`/`path` (a run's `out/`), within the size and count limits. A script may have replaced any folder
 * under `base` with a link: none is followed, not even `out/` or the run's own folder.
 */
export async function collectOutputs(base: string, path: string) {
  const outputs: RunOutputFile[] = [];
  let total = 0;
  let cut = false;
  const walk = async (real: string, root: string, dir: string, depth: number) => {
    // A folder whose real path is another one was reached through a link.
    if ((await realpath(dir)) !== dir) return;
    for (const name of (await readdir(dir)).sort()) {
      const full = join(dir, name);
      const st = await lstat(full);
      if (st.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(real, root, full, depth + 1);
        else cut = true;
      } else if (st.isFile()) {
        const kept = relative(root, full).split(sep).join("/");
        const room = PLAYGROUND_LIMITS.outputBytes - total;
        if (
          outputs.length >= PLAYGROUND_LIMITS.outputFiles ||
          st.size > room ||
          kept.length > 300
        ) {
          cut = true;
          continue;
        }
        const content = await readInside(real, relative(real, full), room);
        if (!content) continue;
        outputs.push({ path: kept, content, mimeType: classify(name).mimeType });
        total += content.length;
      }
    }
  };
  // The script may have removed `out/`: then there is nothing to keep.
  await (async () => {
    const real = await realpath(base);
    const root = join(real, path);
    await walk(real, root, root, 0);
  })().catch(() => {});
  return { outputs, cut };
}

/** A run that ended before the script started. */
export const emptyResult = (status: RunResult["status"], runtimeVersion: string): RunResult => ({
  status,
  exitCode: null,
  stdout: "",
  stderr: "",
  truncated: false,
  outputs: [],
  runtimeVersion,
});

/** The most a result file may hold. A larger one is dropped, so a script cannot fill memory through it. */
export const RESULT_BYTES = 1_000_000;

/**
 * The text of the result file a script wrote in its folder `base`/`dir`, or undefined (none, not a plain file, or too large). A link
 * is never followed, at any level under `base`.
 */
export async function readResult(base: string, dir: string, spec: Pick<RunSpec, "resultFile">) {
  if (!spec.resultFile) return undefined;
  const folder = resolve(base, dir);
  const target = resolve(folder, spec.resultFile);
  if (!target.startsWith(folder + sep)) return undefined;
  const bytes = await readInside(base, relative(base, target), RESULT_BYTES);
  return bytes?.toString("utf8").replaceAll("\0", "");
}
