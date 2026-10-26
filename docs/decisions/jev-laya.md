# Jev and Laya decision contracts

Status: source-backed proposal, 2026-10-22. Bounded [046a research](../../tasks/046a-identify-decision-products.md) supplies inputs to RFC-046/048; it does not complete those parents, RFC-007 or their adapter prerequisites. No service, account, model request or native profile was used. All external sources were accessed 2026-10-22.

## Motivation and constraints

Zetta needs both Jev and Laya to make bounded decisions within a run. Neither becomes the primary conversational harness or gains authority to execute an action. The current actor, allowed candidates, context provenance, account and deadline come from Zetta. Model output selects from those candidates; deterministic authorization and browser/tool guards still control execution.

| Candidate | Trade-off | Recommendation |
| --- | --- | --- |
| TypeSafe HTTP and Laya HTTP behind separate adapters | Shares typed question vocabulary; preserves provider-specific versions/confidence/errors | Use |
| Copy the browser runner into general decision routing | Browser state transformation and checkpoint evaluation do not cover general routing | Use only as browser-specific prior art |
| Replace either required product with a generic chat completion | Changes the selected products and answer semantics | Reject |

Use direct fetch with existing platform validation; no new SDK dependency is needed for the proposed HTTP adapters. Select a backend explicitly. No automatic paid/cloud fallback or transmission of additional private state. Any configured fallback must be authorized, preserve the original actor/context bounds, and remain visible in result provenance.

## Identity and source pins

| Product / artifact | Exact observed or target identity | License / evidence boundary |
| --- | --- | --- |
| Jev | TypeSafe System One hosted API. Proposed initial stable target `jev-1.13.0`; published `jev-1.14.0` is also available | Hosted service under account terms; no downloaded weights or open-source model license established. [API](https://docs.typesafe.ai/api/system-one), [models](https://docs.typesafe.ai/models), [customer agreement](https://typesafe.ai/legal/mca) |
| Laya library | `NandhaKishorM/laya` 0.4.12, commit `ffc142012af63d015fa19f05f29f9c5ff329a2cc`; release published 2026-10-19 | Apache-2.0 code; [manifest](https://github.com/NandhaKishorM/laya/blob/ffc142012af63d015fa19f05f29f9c5ff329a2cc/pyproject.toml), [license](https://github.com/NandhaKishorM/laya/blob/ffc142012af63d015fa19f05f29f9c5ff329a2cc/LICENSE) |
| Local browser checkpoint | `cklxx/laya-browser@645cf366a2ae35f1086e8c20eff48f909bb49206`, model card identifies v19s/mmBERT-base 322M | Apache-2.0 declared in the exact revision's [model card](https://huggingface.co/cklxx/laya-browser/raw/645cf366a2ae35f1086e8c20eff48f909bb49206/README.md). Browser-specific quality only; no Zetta general-routing evaluation |
| Local prior art | `agent-browser-plugin-jev` 0.2.0, clean source HEAD `d12a07c372a88e47bd0c72bf045941e4753473a1` | MIT, locally inspected README, LICENSE, `src/decision.ts`, `tools/laya-server.py`; source reads only |

The local project is `${HOME}/Documents/agent-browser-jev`. Observed SHA-256: `src/decision.ts` = `2615cdad5081c3210a0b643a5caf6e30bc5f3aa20413f66e129316238efdbd10`; `tools/laya-server.py` = `0ef7385330ab6b7683c8503abe9ade290bd59948fa04ccc3846095fcaebe85c6`. These identify actual files, not historical test receipts. No Python runtime, installed library, checkpoint availability or live service readiness was verified.

## Jev wire contract

`POST https://api.typesafe.ai/v1/systemone` uses `Authorization: Bearer <actor-authorized-key>` and UTF-8 `application/json`. Required body: `{model,state,questions}`; `state` accepts string/object/array. `questions` maps caller-chosen names to typed questions. Response: `{model,answers,usage:{input_tokens,output_tokens}}`; answers use the submitted names and matching question types. Treat examples below as synthetic shape fixtures, never observed model output. [Official System One reference](https://docs.typesafe.ai/api/system-one).

| Question | Request / response contract | Initial adapter treatment |
| --- | --- | --- |
| Choice | `type:"choice"`, `instructions`, `criteria` mapping option IDs to descriptions; answer `type,choice,probabilities,confidence`. Choice is an argmax; probabilities cover offered options and sum to 1. Up to 255 provider options | First routing primitive; application provides labels and threshold. [Choice](https://docs.typesafe.ai/primitives/choice) |
| Score | `type:"score"`, instructions and ordered descriptive levels; answer includes numeric `score`, `legend`, `probabilities`, `confidence` | Available provider capability; add only for a named caller with accepted level schema. [Score](https://docs.typesafe.ai/primitives/score) |
| Noul | `type:"noul"`, instructions, optional true/false criteria; answer `type:"noul",noul` in [0,1] | No separate confidence field; define positive/negative/uncertain thresholds in caller configuration. [Noul](https://docs.typesafe.ai/primitives/noul) |
| Box / assets | Vision questions and image assets require an explicit danger-zone image header and suitable model | Unsupported in the initial text-decision path; never infer image support from the text model catalog |

```json
{"model":"jev-1.13.0","state":{"request":"Summarize the supplied notes"},"questions":{"route":{"type":"choice","instructions":"Select a route for this request","criteria":{"summarize":"Summarize supplied notes","unsupported":"Request needs another capability"}}}}
```

```json
{"model":"jev-1.13.0","answers":{"route":{"type":"choice","choice":"summarize","probabilities":{"summarize":1,"unsupported":0},"confidence":1}},"usage":{"input_tokens":50,"output_tokens":10}}
```

Validate exact answer/question identity, type, offered choice/probability keys, finite [0,1] values, nonnegative integer usage and expected model identity. Bound all strings/maps. A selected candidate must have maximal probability; tolerate only an explicitly chosen numerical sum tolerance, not missing/extra actions. Equal/tied or below-threshold decisions become `uncertain` under caller policy. Confidence and top probability are distinct; never manufacture one from the other. Action labels and thresholds are Zetta configuration, not provider-authorized operations.

The [model page](https://docs.typesafe.ai/models) currently lists 64k tokens/request and 32k/question for both published versions. Its alias table maps `jev-latest` to 1.13.0 and `jev-preview` to 1.14.0, while identifying 1.14 as the newest release. Pin the version and retain the returned actual model. `GET /v1/models` is authenticated catalog discovery; it was not called. Long-context and image headers stay off unless separately accepted.

### Limits, cancellation and errors

Provider rules: body at most 32 MiB, UTF-8 without BOM, at most 64 nesting levels and finite numbers. Compression has separate restrictions; send uncompressed bounded JSON initially. Status mapping is `400` malformed/context limit, `401` missing/invalid auth, `413` size, `415` compression, `422` question validation, `429` rate limit and `529` overload. Provider recommends exponential backoff for 429/529. [Published rules](https://docs.typesafe.ai/api/errors).

**Proposed Zetta budgets**, pending adapter acceptance: 32 KiB outbound JSON, 64 KiB decoded response, nesting 16, at most eight named questions and 32 choices per question; no assets or batch endpoint. End-to-end deadline is min(run time remaining, 10 seconds), including queue/body read, with at most one active call per actor and two per installation initially. Admit no new work when those finite slots are full; return a retryable busy outcome. These are local safety budgets, not measured latency or provider limits.

Use combined caller/deadline abort signals and cancel response-body reads. No provider cancellation/job API was established; aborting fetch does not prove remote inference or billing stopped. Ignore late results and do not execute them. Initial adapter makes no automatic retry; surface retryable overload/rate-limit status with safe retry timing. A later bounded retry policy must fit the same deadline and acknowledge possible duplicate billed inference. Decisions have no direct tool side effect; executing the selected action is a separate reauthorized step.

### Authentication and egress

Resolve the initiating actor's approved TypeSafe connection through RFC-007 only at dispatch. No environment/server/admin credential fallback, arbitrary endpoint override, URL credentials or redirects. Allow the fixed HTTPS API origin under the approved egress policy. Token values and full request/response bodies never enter logs. Return safe category, pinned/actual model, question-schema version, timing and bounded usage metadata.

Send only the approved current task fields and authorized retrieved context; never whole private conversation history, other actors' memory, credential-entry screens or account tokens by default. TypeSafe's [privacy policy](https://typesafe.ai/legal/privacy-policy) says it collects input, does not train/fine-tune on it, and retains personal data as reasonably necessary. Its [DPA](https://typesafe.ai/legal/data-processing) permits documented processing/subprocessors and international transfer terms; [legal overview](https://docs.typesafe.ai/legal) describes enterprise ZDR. **No default zero-retention, residency or account entitlement is proved.** Owner acceptance of actual transmitted fields and account terms remains a parent gate.

## Laya: two different server surfaces

### Local browser wrapper, observed source

The local script requires Python >=3.11 and declares `laya==0.4.12`. It loads the exact browser checkpoint above, selects MPS when available or CPU, sets model lengths 1024/768 and disables reference compilation. It binds `127.0.0.1:8791` by default. `POST /v1/systemone` optionally checks `LAYA_API_KEY`, requires 0 < Content-Length <= 1,000,000, then calls `model.predict(state,questions)` under one threading lock. `/health` exposes model/revision/device without authentication. Returned model is `<checkpoint>@<revision>` and latency includes lock wait.

This is **not a general pass-through**: it rebuilds state into form fields (2,000 chars), page text (1,200 chars), and ten recent actions, and compacts structured criteria into short browser labels. It assumes object state and per-question criteria. It does not enforce bounded concurrent handler threads, socket read deadlines, output size or inference cancellation. Invalid Content-Length parsing occurs outside its catch; most prediction failures become generic 422. Requests can wait behind the lock after their clients leave. No existing user process was inspected, stopped or reused.

The pinned [checkpoint card](https://huggingface.co/cklxx/laya-browser/raw/645cf366a2ae35f1086e8c20eff48f909bb49206/README.md) describes browser operation/target choices and documented failures such as stopping early. Its measurements do not establish Zetta's domain quality, hardware latency or readiness. Browser text generation, login and action execution remain separate capabilities.

### Official Laya 0.4.12 server, source-supported alternative

Pinned [`laya/serve.py`](https://github.com/NandhaKishorM/laya/blob/ffc142012af63d015fa19f05f29f9c5ff329a2cc/laya/serve.py) exposes `POST /v1/systemone`, `/v1/systemone/batch` and `GET /health`. It returns Jev-shaped model/answers/usage plus optional Laya routing/answer metadata. Defaults include host **0.0.0.0**, port8000, optional `LAYA_API_KEY`, 2 MiB bodies, 50,000 state chars, 64 questions, 100 Choice options (255 only with tournament enabled), 32 Score levels and 512 total options. It admits at most `LAYA_MAX_CONCURRENT` (default16), returning 503/Retry-After when full; actual inference uses a single-worker executor and an asyncio lock. Validation maps to 400/413/422, auth to401 and inference failure to500.

**Confidence is not interchangeable:** Laya's `confidence` is normalized entropy. Its `answer_confidence` represents maximum probability; `x_jev_confidence` offers a Jev-formula projection. Native `min_confidence` has provider-specific gate behavior, including abstention/unevaluated outcomes. Keep these fields distinct and calibrate thresholds by checkpoint, task and option count; do not import a Jev threshold onto Laya's `confidence`. [Pinned confidence implementation](https://github.com/NandhaKishorM/laya/blob/ffc142012af63d015fa19f05f29f9c5ff329a2cc/laya/confidence.py).

Official routing includes English, multilingual and typed-decisions checkpoints; automatic routing can change the effective model. Source's reviewed revisions are `convaiinnovations/laya@55cf4c4ebb4ebe31b2550e8bdf3bd21b99753851`, multilingual `e4e9ddf21a7b1903b7acffd8814ad4307bf63a67`, typed-decisions `1a793eb568e6718f15941d08f85432581df534e3`. These are **published source pins**, not downloaded/verified weights. `LAYA_REVISION=reviewed` is opt-in; default Hub loading can move. [Revision policy](https://github.com/NandhaKishorM/laya/blob/ffc142012af63d015fa19f05f29f9c5ff329a2cc/laya/revisions.py), [router](https://github.com/NandhaKishorM/laya/blob/ffc142012af63d015fa19f05f29f9c5ff329a2cc/laya/router.py).

### Deployment recommendation and explicit blockers

Prefer an isolated operator-managed official server over promoting the local browser wrapper. Pin library, runtime/device and exact approved checkpoints; preload only those weights; disable arbitrary model sources, hooks, tournament expansion and downloads during requests. A browser deployment can use the browser checkpoint only after exact-schema tests; general routing needs a selected general/multilingual/typed checkpoint and domain evaluation. This recommendation selects the service surface, **not an accepted checkpoint or installed service**.

Authenticate through an actor/run-bound trusted gateway, restrict the service network to it, require a lease credential and enforce the smaller Zetta budgets above. Loopback alone is not a multi-user boundary. Keep request context in memory only, omit content logging/caches and prevent concurrent actor state reuse. Immutable public weights may be shared read-only; private requests, caches, logs and execution identity may not. Startup may need Hugging Face/network downloads and checkpoint custom code; approve provisioning and dependency/code licenses first, then run from reviewed offline artifacts. Apache code/model declarations do not transfer licenses of unrelated assets automatically.

No inference-cancellation endpoint was established. Client abort and thread/executor cancellation do not prove compute stopped. For hard cancellation, select a supervisor-owned process boundary and demonstrate kill/restart/drain behavior; do not kill a shared server on behalf of one actor. Prove bounded queue wait, overload, GPU/CPU fallback, startup and native health/readiness without exposing model/hardware details to unauthorized actors. No latency claim follows from source.

Laya is local only when its selected deployment and traffic actually stay local. The proposed local service has no inference egress after offline provisioning; prove that with network enforcement. A remote Laya deployment needs its own accepted endpoint, retention/account policy and actor connection. Neither local nor remote mode may silently fall back to TypeSafe or a conversational model.

## Normalized outcomes and real acceptance

Future adapter output should distinguish `decision`, `uncertain`, `unsupported`, `auth_required`, `busy`, `invalid_result`, `timeout`, `cancelled` and `unavailable`, with immutable run identity and source metadata. These are proposed capability/outcome names for RFC-006/047/049, not new exported code. Never interpret errors, empty answers, unsupported domains, unconfigured thresholds or model abstention as an affirmative action.

Required fixture cases: exact synthetic request/response above; wrong/missing question/model/type; extra choice or action; incomplete, negative, NaN/overflow and non-normalized probabilities; tie/low-confidence/abstention; bounded response/UTF-8; 401/429/529 and Laya503; queue/deadline/caller cancellation/late completion; A/B connection and result substitution; browser checkpoint receiving non-browser state; Laya confidence metric mismatch. Test the outcome and authorized next action, not private adapter state.

Required approved live evidence: harmless actor-owned request per selected pinned backend/checkpoint, correct data minimization and model identity, real cancel/overload/restart/isolation, measured domain quality and hardware latency, and no unexpected provider egress. Current research proves none of those. RFC-007/009 contracts, owner egress acceptance, Laya runtime/checkpoint selection and budget acceptance remain concrete implementation gates. Parent046/048 retain their planned individual artifact paths until the coordinator accepts this consolidated research mapping.
