# Decision and memory integration leads

Research notes, 2026-10-22. These establish product identity and source anchors for RFC-046/048/054; they do not accept an integration or complete its prerequisites. No account lookup, credential read, model request or install was performed.

## Jev

Jev is TypeSafe's System One model. The supported HTTP interface is POST `https://api.typesafe.ai/v1/systemone` with Bearer authentication and JSON `{model,state,questions}`; answers are keyed by question name, with model identity and usage. The reference includes Choice, Score, Noul and Box question types. [Official API](https://docs.typesafe.ai/api/system-one).

The current model page lists versioned Jev IDs and movable aliases. Pin the tested version for routing thresholds and retain the response's actual model ID. Catalog discovery uses authenticated GET `/v1/models`; it remains unexecuted. [Official model documentation](https://docs.typesafe.ai/models).

Requests require bounded UTF-8 JSON and finite numbers. The provider documents body/nesting limits and status-specific validation, authentication, rate-limit and overload errors. Zetta should apply smaller local budgets, finite deadlines and bounded response parsing; source-backed transport support is not evidence of account readiness or approval to transmit private context. [Request rules and errors](https://docs.typesafe.ai/api/errors).

Integration proposal: resolve an actor-owned connection reference after authorization, allow only configured named decision choices, validate probabilities/answer identity, then let application code select an already-authorized action. A model-selected action cannot expand actor authority. No default credential, arbitrary endpoint or automatic unbounded retry.

## Laya

Related local project `${HOME}/Documents/agent-browser-jev` contains a guarded TypeScript browser runner and `tools/laya-server.py`. Its inspected decision client speaks the same System One endpoint shape to a loopback server, while its server pins a browser-trained Laya checkpoint. This is a lead for reproducibility, not a general-purpose model contract or proof of a running service. The [upstream model card](https://huggingface.co/cklxx/laya-browser) and exact pinned source must be reconciled before RFC-048 accepts it.

Open questions: selected deployment/runtime and revision, supported non-browser decision domain, typed payload/schema, model-loading cost, authorization, health/readiness, cancellation and concurrency. A loopback endpoint alone does not establish isolation; another actor must not reach its private state or select another actor's context. Test actual decision quality and malformed/unsupported cases before routing product work.

## Hermes-style memory

Hermes documents bounded curated MEMORY.md and USER.md stores, frozen prompt snapshots at session start, explicit add/patch/remove operations and overflow errors rather than silent eviction. Its documented default capacities are2200 and1375 characters. It warns against sharing one home between writers; profile isolation or a suitable external provider is required. [Official persistent-memory documentation](https://hermes-agent.nousresearch.com/docs/user-guide/features/memory).

Candidate for RFC-054: implement the documented semantics through Zetta's durable, actor-scoped database service, exposed through the accepted host-tool bridge. Keep native harness homes private and disable uncontrolled native memory discovery. Use immutable context snapshots per run, explicit live read/write results, revision/conflict checks and bounded budgets. Existing conversation history remains distinct from curated memory; forgetting must invalidate later retrieval without rewriting completed run evidence. This is an implementation proposal requiring source/license review and acceptance, not a claim that Hermes is installed or connected.
