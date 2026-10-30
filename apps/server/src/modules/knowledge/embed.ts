import { homedir } from "node:os";
import { join } from "node:path";

/** Turns text into vectors that are close when the meaning is close, across languages. `query` and `passage` use the model's two prefixes. */
export type Embedder = {
  embed(
    texts: string[],
    kind: "query" | "passage",
    opts?: { signal?: AbortSignal },
  ): Promise<number[][]>;
};

/** Embeds one search query within `ms`; on timeout the embedder drops the query if it has not started, and the caller falls back to keywords. */
export async function embedQuery(
  embedder: Embedder,
  q: string,
  ms: number,
): Promise<number[] | undefined> {
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(new Error("slow")), ms);
  try {
    const slow = new Promise<never>((_, rej) =>
      ctl.signal.addEventListener("abort", () => rej(ctl.signal.reason), { once: true }),
    );
    return (await Promise.race([embedder.embed([q], "query", { signal: ctl.signal }), slow]))[0];
  } finally {
    clearTimeout(timer);
  }
}

export const EMBEDDING_MODEL = "Xenova/multilingual-e5-small";
const BATCH = 8;

/**
 * The embedding model runs inside the server process (ONNX/WASM through @huggingface/transformers): no API key, and no text leaves
 * the machine. The model files download once into ZETTA_EMBEDDING_MODEL_DIR (default ~/.cache/zetta/models); pre-seed that folder
 * for an offline server. It loads on first use and runs one batch at a time; a query goes ahead of queued passage batches, so bulk
 * indexing does not starve chat retrieval. ZETTA_EMBEDDING=off turns it off (keyword search only).
 */
export function createLocalEmbedder(
  opts: { cacheDir?: string; extractor?: (texts: string[]) => Promise<number[][]> } = {},
): Embedder {
  let extractor: Promise<(texts: string[]) => Promise<number[][]>> | undefined;
  let busy = false;
  const queries: (() => void)[] = [];
  const passages: (() => void)[] = [];
  /** Waits for the single model slot. A query waits in its own lane, served first; an aborted wait leaves the queue. */
  const acquire = (kind: "query" | "passage", signal?: AbortSignal) =>
    new Promise<void>((resolve, reject) => {
      if (signal?.aborted) return reject(signal.reason);
      if (!busy) {
        busy = true;
        return resolve();
      }
      const lane = kind === "query" ? queries : passages;
      const turn = () => {
        signal?.removeEventListener("abort", onAbort);
        resolve();
      };
      const onAbort = () => {
        lane.splice(lane.indexOf(turn), 1);
        reject(signal!.reason);
      };
      signal?.addEventListener("abort", onAbort, { once: true });
      lane.push(turn);
    });
  const release = () => {
    const next = queries.shift() ?? passages.shift();
    if (next) next();
    else busy = false;
  };
  const load = () => {
    extractor ??= opts.extractor
      ? Promise.resolve(opts.extractor)
      : (async () => {
          const { pipeline, env } = await import("@huggingface/transformers");
          env.cacheDir =
            opts.cacheDir ??
            process.env.ZETTA_EMBEDDING_MODEL_DIR ??
            join(homedir(), ".cache", "zetta", "models");
          const fe = await pipeline("feature-extraction", EMBEDDING_MODEL, { dtype: "q8" });
          return async (texts: string[]) =>
            (await fe(texts, { pooling: "mean", normalize: true })).tolist() as number[][];
        })().catch((e) => {
          extractor = undefined;
          throw e;
        }); // a failed download is retried on the next call
    return extractor;
  };
  return {
    async embed(texts, kind, opts) {
      if (process.env.ZETTA_EMBEDDING === "off") throw new Error("embedding disabled");
      const out: number[][] = [];
      for (let i = 0; i < texts.length; i += BATCH) {
        await acquire(kind, opts?.signal);
        try {
          const run1 = await load();
          out.push(...(await run1(texts.slice(i, i + BATCH).map((t) => `${kind}: ${t}`))));
        } finally {
          release();
        }
      }
      return out;
    },
  };
}
