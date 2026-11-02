/**
 * Laya — TypeScript port of the checkpoint's rl_agent_api.py on top of onnxruntime-node.
 *
 * `Laya.load()` resolves the ONNX bundle (a local directory, or the published Hugging Face repo, cached
 * under ~/.cache/receptron-laya), builds the tokenizer, and opens the session. `systemOne()` then answers
 * any number of typed questions about one state in a single forward pass, exactly as the Python
 * reference does (same sequence layout, same per-cardinality temperature, same rounding).
 */
import { readFile } from "node:fs/promises";
import path from "node:path";
import * as ort from "onnxruntime-node";
import { Tokenizer } from "@huggingface/tokenizers";
import {
  buildSequence,
  checkChoiceLabels,
  clampTemperatures,
  confidenceFromProbs,
  QTYPES,
  renderOptions,
  softmax,
  temperatureFor,
  toInternal,
  type SpecialIds,
} from "./sequence";
import { actProbabilities, floatLogits, normalizeConfig } from "./adapt";
import { ensureBundle, type DownloadOptions } from "./download";
import { VARIANTS, type LayaVariant } from "./variants";
import type { Answer, LayaConfig, Question, SystemOneResult } from "./types";

export interface LayaOptions extends DownloadOptions {
  /**
   * Directory holding the bundle files of the chosen variant (see `VARIANTS[variant].files`). For the English
   * variant that is the output of export/export_onnx.py. When given, nothing is downloaded and the Hugging Face options are ignored.
   */
  modelDir?: string;
  /** Which checkpoint to run (default: english). */
  variant?: LayaVariant;
  /** Override special-token ids. Only for checkpoint parity checks; the default reads them from the tokenizer. */
  ids?: Partial<Omit<SpecialIds, "maskTok">>;
  /** onnxruntime execution providers (default: ["cpu"]) */
  executionProviders?: ort.InferenceSession.ExecutionProviderConfig[];
  /** extra onnxruntime session options (merged over the defaults) */
  sessionOptions?: ort.InferenceSession.SessionOptions;
}

const round4 = (x: number) => Math.round(x * 1e4) / 1e4;

export class Laya {
  private constructor(
    private readonly session: ort.InferenceSession,
    private readonly tok: Tokenizer,
    readonly config: LayaConfig,
    private readonly ids: SpecialIds,
    /** where the bundle was loaded from */
    readonly modelDir: string,
    readonly variant: LayaVariant,
  ) {}

  static async load(opts: LayaOptions = {}): Promise<Laya> {
    const modelDir = opts.modelDir
      ? path.resolve(opts.modelDir)
      : await ensureBundle({ ...opts, variant: opts.variant ?? "english" });
    const read = async (f: string): Promise<unknown> =>
      JSON.parse(await readFile(path.join(modelDir, f), "utf8"));
    const variant = opts.variant ?? "english";
    const spec = VARIANTS[variant];
    const config = clampTemperatures(normalizeConfig(variant, await read(spec.config.file)));
    const tok = new Tokenizer(
      (await read(spec.tokenizer)) as object,
      (await read(spec.tokenizerConfig)) as object,
    );
    const id = (t: string) => {
      const v = tok.token_to_id(t);
      if (v === undefined) throw new Error(`special token ${t} missing from tokenizer`);
      return v;
    };
    const ids: SpecialIds = {
      cls: opts.ids?.cls ?? id(spec.tokens.cls),
      sep: opts.ids?.sep ?? id(spec.tokens.sep),
      mask: opts.ids?.mask ?? id(spec.tokens.mask),
      pad: opts.ids?.pad ?? id(spec.tokens.pad),
      maskTok: spec.tokens.mask,
    };
    const session = await ort.InferenceSession.create(path.join(modelDir, spec.model), {
      executionProviders: opts.executionProviders ?? ["cpu"],
      graphOptimizationLevel: "all",
      ...opts.sessionOptions,
    });
    return new Laya(session, tok, config, ids, modelDir, variant);
  }

  private readonly encode = (text: string): number[] =>
    this.tok.encode(text, { add_special_tokens: false }).ids;

  /** Answer every question about `state` in one forward pass (Jev's `system_one` request/response shape). */
  async systemOne<Q extends Record<string, Question>>(
    state: unknown,
    questions: Q,
  ): Promise<SystemOneResult<Q>> {
    const qids = Object.keys(questions);
    if (qids.length === 0) {
      throw new Error("systemOne: at least one question is required");
    }
    const items = qids.map((qid) => {
      const qdef = questions[qid] as Question;
      checkChoiceLabels(qid, qdef);
      const q = toInternal(qdef);
      const { ids, markers } = buildSequence(
        this.encode,
        this.ids,
        state,
        q,
        this.config.max_len,
        this.config.head_max_len,
      );
      if (markers.length !== renderOptions(q).length) {
        throw new Error(
          `question ${JSON.stringify(qid)}: options do not fit in head_max_len=${this.config.head_max_len} tokens`,
        );
      }
      return { q, ids, markers, qtype: QTYPES[q.t] };
    });

    // rl_common.collate_items: right-pad to the longest sequence / widest option set in the batch
    const n = items.length;
    const L = Math.max(...items.map((it) => it.ids.length));
    // at least 2 slots: the graph's act head takes the top two probabilities, so a single-option
    // question gets a masked second slot (p = 0), as upstream laya pads it
    const K = Math.max(2, ...items.map((it) => it.markers.length));
    const inputIds = new BigInt64Array(n * L).fill(BigInt(this.ids.pad));
    const attention = new BigInt64Array(n * L);
    const markerPos = new BigInt64Array(n * K);
    const markerMask = new Uint8Array(n * K);
    const qtype = new BigInt64Array(n);
    let nTokens = 0;
    items.forEach((it, i) => {
      it.ids.forEach((v, j) => {
        inputIds[i * L + j] = BigInt(v);
        attention[i * L + j] = 1n;
      });
      nTokens += it.ids.length;
      it.markers.forEach((m, j) => {
        markerPos[i * K + j] = BigInt(m);
        markerMask[i * K + j] = 1;
      });
      qtype[i] = BigInt(it.qtype);
    });

    const out = await this.session.run({
      input_ids: new ort.Tensor("int64", inputIds, [n, L]),
      attention_mask: new ort.Tensor("int64", attention, [n, L]),
      marker_pos: new ort.Tensor("int64", markerPos, [n, K]),
      marker_mask: new ort.Tensor("bool", markerMask, [n, K]),
      qtype: new ort.Tensor("int64", qtype, [n]),
    });
    const logits = floatLogits(out["logits"]?.data);
    const act = actProbabilities(VARIANTS[this.variant].act, out[VARIANTS[this.variant].act], n);

    const answers: Record<string, Answer> = {};
    items.forEach((it, r) => {
      const qid = qids[r] as string;
      const k = it.markers.length;
      const temp = temperatureFor(this.config, it.qtype, k);
      const p = softmax(Array.from(logits.subarray(r * K, r * K + k), (v) => v / temp));
      const ext = { act_probability: act[r] ?? 0 };
      // max(p): the quantity the temperatures are fitted for, comparable across question types
      const answerConfidence = round4(Math.max(...p));
      const q = it.q;
      if (q.t === "choice") {
        const keys = Object.keys(q.crit as Record<string, string | null>);
        const best = p.indexOf(Math.max(...p));
        answers[qid] = {
          type: "choice",
          choice: keys[best] as string,
          probabilities: Object.fromEntries(keys.map((kk, i) => [kk, round4(p[i] ?? 0)])),
          confidence: round4(confidenceFromProbs(p)),
          answer_confidence: answerConfidence,
          rl_agent: ext,
        };
      } else if (q.t === "score") {
        const crit = q.crit as string[];
        answers[qid] = {
          type: "score",
          score: round4(p.reduce((s, v, i) => s + i * v, 0)),
          legend: Object.fromEntries(crit.map((c, i) => [String(i), c])),
          probabilities: Object.fromEntries(p.map((v, i) => [String(i), round4(v)])),
          confidence: round4(confidenceFromProbs(p)),
          answer_confidence: answerConfidence,
          rl_agent: ext,
        };
      } else {
        answers[qid] = {
          type: "noul",
          noul: round4(p[1] ?? 0),
          answer_confidence: answerConfidence,
          rl_agent: ext,
        };
      }
    });
    return {
      model: "laya",
      answers: answers as SystemOneResult<Q>["answers"],
      usage: { input_tokens: nTokens, output_tokens: 0 },
    };
  }

  /** Release the ONNX session. The instance must not be used afterwards. */
  async close(): Promise<void> {
    await this.session.release();
  }
}
