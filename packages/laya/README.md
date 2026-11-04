# @zetta/laya

Runs Laya, the open-source Jev-compatible "System 1" decision model, in Node/Bun with ONNX Runtime. Two checkpoints:

| Variant        | Hugging Face repo                                                              | Download            |
| -------------- | ------------------------------------------------------------------------------ | ------------------- |
| `english`      | `receptron/laya-onnx` (`main`)                                                 | about 1.7 GB        |
| `multilingual` | `onnx-community/laya-multilingual-ONNX` (pinned commit, see `src/variants.ts`) | about 1.3 GB (fp32) |

Weights are cached under `$LAYA_CACHE` or `~/.cache/receptron-laya`.

## Origin

Vendored from [receptron/laya](https://github.com/receptron/laya) at commit `60d5ee6ef8e731646e8ca9ac0139d25fcf4fa295` (MIT, see `LICENSE`). The published `@receptron/laya@0.2.0` can only load the English bundle and exports no internals, so the source lives here.

Changes against upstream:

- Imports without `.js` extensions (the repo uses bundler resolution). The `@huggingface/tokenizers` typings shim is dropped for the same reason.
- `src/variants.ts` and `src/adapt.ts` (new): the differences between the two checkpoints.
- `laya.ts`: `Laya.load({ variant })`; special tokens, config and act head come from the variant.
- `download.ts`: file list, repo and revision come from the variant.
- `sequence.ts`, `types.ts`: unchanged. Tests are ported to `bun:test`.

## Multilingual checkpoint

The graph has the same inputs as the English one. The outputs are `logits` and `act_logits` (not `act_probs`). Calibration is in `config.json#laya`. The tokenizer is Gemma-style, so the special tokens are `<bos> <eos> <mask> <pad>`.

`config.json` lists `cls_token_id: 1`, but the tokenizer declares `cls_token: <bos>` (id 2). The loader uses the tokenizer's own token names. `LayaOptions.ids` can override them to compare the two.

Measured on 2026-11-01 with a real-model test (downloaded 1.3 GB; the test was removed 2026-11-04 with the other opt-in real-model tests):

- The same refund request in en, pt, es, ja, zh: "billing" for en, pt, es, zh (confidence 0.69–0.89). Japanese picked "support" at 0.57, so it is the weak one. A bug report in en, pt, ja: "support" at 0.95–0.97.
- cls id 2 (tokenizer `<bos>`, used) against cls id 1 (`config.json`): both 7 of 8 right, confidences within 0.08. The choice does not matter on this sample.
- Attention rubric: both models order the prompts alike. "thanks!" scores 0.39 (confidence 0.72) on multilingual and 0.08 (0.96) on English. The largest task scored 1.72 and 2.13. No prompt reached the "complex" threshold of 2.4 on either model.

The fp16 graph is not used: it may return float16 tensors, and `systemOne` needs float32.

## Updating from upstream

Diff `src/{sequence,types,laya,download}.ts` against the upstream commit and port the changes by hand.
