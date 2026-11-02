/**
 * The two checkpoints Zetta can run. They share the graph inputs and the question layout, and differ in where the
 * files live, which special tokens the tokenizer uses, where the calibration config is, and what the act head returns.
 */
export type LayaVariant = "english" | "multilingual";

export interface VariantSpec {
  /** Hugging Face repo id. */
  repo: string;
  /** git revision. The multilingual weights are pinned to a commit; the English bundle follows `main` (its cache is already on disk for existing installs). */
  revision: string;
  /** Everything to download, relative to the repo root. */
  files: readonly string[];
  /** The ONNX graph, relative to the bundle directory. */
  model: string;
  /** Calibration config. `section` is the key that holds it when the file is a shared `config.json`. */
  config: { file: string; section?: string };
  tokenizer: string;
  tokenizerConfig: string;
  /** Token strings of the four special ids. */
  tokens: { cls: string; sep: string; mask: string; pad: string };
  /** Name of the act-head output: probabilities, or logits that still need a softmax. */
  act: "act_probs" | "act_logits";
  /** Approximate download, in GB, for the UI. */
  sizeGb: number;
}

export const VARIANTS: Record<LayaVariant, VariantSpec> = {
  english: {
    repo: "receptron/laya-onnx",
    revision: "main",
    files: [
      "laya.onnx",
      "laya.onnx.data",
      "laya_config.json",
      "tokenizer/tokenizer.json",
      "tokenizer/tokenizer_config.json",
    ],
    model: "laya.onnx",
    config: { file: "laya_config.json" },
    tokenizer: "tokenizer/tokenizer.json",
    tokenizerConfig: "tokenizer/tokenizer_config.json",
    tokens: { cls: "[CLS]", sep: "[SEP]", mask: "[MASK]", pad: "[PAD]" },
    act: "act_probs",
    sizeGb: 1.7,
  },
  multilingual: {
    repo: "onnx-community/laya-multilingual-ONNX",
    revision: "46b77bbf5642fec5f14e540570228a8cbe8ab81f",
    files: [
      "onnx/model.onnx",
      "onnx/model.onnx_data",
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
    ],
    model: "onnx/model.onnx",
    config: { file: "config.json", section: "laya" },
    tokenizer: "tokenizer.json",
    tokenizerConfig: "tokenizer_config.json",
    // Gemma-style tokenizer (mmBERT). The tokenizer's own cls/sep tokens are <bos>/<eos>; config.json lists different ids (see README).
    tokens: { cls: "<bos>", sep: "<eos>", mask: "<mask>", pad: "<pad>" },
    act: "act_logits",
    sizeGb: 1.3,
  },
};
