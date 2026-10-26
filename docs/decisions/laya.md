# Laya runtime decision (RFC-048)

Status: accepted for v1. Supersedes the "Python Laya 0.4.12 server" runtime lead in `jev-laya.md` for the **builtin** model.

- **Runtime chosen:** the npm package `@receptron/laya` (v0.2.x), ONNX Runtime on CPU, loaded **in the Zetta server process**. Free, local, no account, no network after the first weight download (~1.7 GB from Hugging Face into `~/.cache/receptron-laya`; override `LAYA_CACHE`). Source: <https://github.com/receptron/laya>; model: `convaiinnovations/laya` (Jev-compatible System-1 decision model).
- **Why not the Python server:** no Python dependency, one process, typed API (`choice`/`score`/`noul`), measured 3-question call ≈140 ms warm on Apple silicon.
- **Wire shape:** same request/response shape as Typesafe Jev `system_one` (see `jev-laya.md`), so the Jev adapter and Laya are interchangeable per bot (`decision_config.backend`).
- **Operational rules implemented** (`modules/decisions/service.ts`): lazy load + background warm-up at boot (`ZETTA_LAYA_PRELOAD=0` disables), calls serialized, 30 s deadline that releases the queue and discards the model, strict output validation (choice among offered options, probabilities sum to 1), confidence threshold → `uncertain`, provenance (model, time, ms) on every result.
- **Confidence semantics:** Zetta uses the probability of the chosen option (`max p`), not the entropy-based `confidence` field.
- **Limits:** ≤ ~20 options per choice question (model recommendation); each question's options must fit 192 tokens; ~2 GB RAM while loaded.
- **Evidence:** real-model test (`ZETTA_LAYA_TEST=1`) classifies a refund ticket as `billing` (95.4%); fake-model tests cover timeout/invalid/uncertain.
