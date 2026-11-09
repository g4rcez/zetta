import { lstat, mkdir, readdir, readFile, writeFile } from "node:fs/promises";
import { dirname, join, relative, resolve, sep } from "node:path";
import { classify } from "../artifacts/storage";
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

/** Writes the snapshot, `inputs.json` and an empty `out/`. A path that leaves the folder is refused, even though the service checked it. */
export async function writeFolder(dir: string, spec: Pick<RunSpec, "files" | "inputs">) {
  for (const f of spec.files) {
    const target = resolve(dir, f.path);
    if (!target.startsWith(dir + sep))
      throw new PlaygroundError("INVALID", "A file path leaves the folder.");
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, f.content);
  }
  await writeFile(join(dir, "inputs.json"), JSON.stringify(spec.inputs));
  await mkdir(join(dir, "out"), { recursive: true });
}

/** The regular files under `out/`, within the size and count limits. A link is never followed. */
export async function collectOutputs(root: string) {
  const outputs: RunOutputFile[] = [];
  let total = 0;
  let cut = false;
  const walk = async (dir: string, depth: number) => {
    for (const name of (await readdir(dir)).sort()) {
      const full = join(dir, name);
      const st = await lstat(full);
      if (st.isDirectory()) {
        if (depth < MAX_DEPTH) await walk(full, depth + 1);
        else cut = true;
      } else if (st.isFile()) {
        const path = relative(root, full).split(sep).join("/");
        if (
          outputs.length >= PLAYGROUND_LIMITS.outputFiles ||
          total + st.size > PLAYGROUND_LIMITS.outputBytes ||
          path.length > 300
        ) {
          cut = true;
          continue;
        }
        outputs.push({ path, content: await readFile(full), mimeType: classify(name).mimeType });
        total += st.size;
      }
    }
  };
  // The script may have removed `out/`: then there is nothing to keep.
  await walk(root, 0).catch(() => {});
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

/** The text of the result file a script wrote in its folder, or undefined (none, not a plain file, or too large). A link is never followed. */
export async function readResult(dir: string, spec: Pick<RunSpec, "resultFile">) {
  if (!spec.resultFile) return undefined;
  const target = resolve(dir, spec.resultFile);
  if (!target.startsWith(dir + sep)) return undefined;
  try {
    const st = await lstat(target);
    if (!st.isFile() || st.size > RESULT_BYTES) return undefined;
    return (await readFile(target, "utf8")).replaceAll("\0", "");
  } catch {
    return undefined;
  }
}
