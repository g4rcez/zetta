# RFC-046a: Identify decision products and transport inputs

- **Parents:** [RFC-046](046-identify-and-verify-jev-integration.md), [RFC-048](048-identify-and-verify-laya-integration.md); root-index parent rows remain authoritative.
- **Status:** Review, 2026-10-22; research inputs recorded, operational acceptance blocked.
- **Type:** Bounded read-only research
- **Prerequisites for implementation:** Accepted [RFC-007](007-store-user-owned-connection-references.md) connection ownership and [RFC-009](009-persist-run-lifecycle-and-idempotency.md) run lifecycle, plus each parent's decisions/live-call scope.

## Scope and authority

User's continued v1 authorization and coordinator assignment permit primary-source/local-code discovery ahead of incomplete parent prerequisites. Own only this child and `docs/decisions/jev-laya.md` for this slice. Read parent046/048, adapters047/049, relevant dependency handoffs, source-leads decision and the local runner README/decision client/Laya server. No installs, account/auth values/status, model calls, service starts or native profile changes.

## Goal and exported input

[Jev/Laya decision contract](../docs/decisions/jev-laya.md) identifies hosted TypeSafe Jev, library/checkpoint Laya and local prior art separately. It records exact source revisions, licenses, JSON request/answer shapes, provider-specific confidence, auth/egress, finite proposed local budgets, cancellation limits, concurrency/errors, fixtures and operational blockers. It is not a production adapter/API/schema. Combined research does not silently satisfy parent046's `jev.md` or parent048's `laya.md` artifact requirement; coordinator must accept that path mapping or link the final parent artifacts.

## Acceptance and verification

- [x] Exact identities/revisions and primary source URLs/access dates.
- [x] Source-backed contracts distinguished from proposals and live unknowns.
- [x] Scoped error/fallback/budget/conformance cases recorded.
- [ ] Actual transmitted fields/account/retention accepted; selected Laya runtime/checkpoints and routing thresholds evaluated; parent prerequisites/live compatibility complete.

Run documentation relative-link/required-section and embedded synthetic JSON checks after writing. No runtime/model tests are authorized in this research slice. Source metadata reads prove version/provenance, not live readiness.

## Completion record

- **Status:** Review; parent046/048 remain incomplete, no adapter implementation unblocked by this child alone.
- **Approval:** Coordinator's bounded research assignment under user's v1 authorization; no new service/dependency/schema approval inferred.
- **Changed paths:** This child and `docs/decisions/jev-laya.md` only for decision-product research. Shared parent/index/source files preserved.
- **Evidence:** Local clean HEAD `d12a07c372a88e47bd0c72bf045941e4753473a1`, package0.2.0/MIT, `shasum -a 256` of the two inspected implementation files recorded in artifact. GitHub source pins Laya0.4.12 at `ffc142012af63d015fa19f05f29f9c5ff329a2cc`; pinned Hugging Face model card read via public scrape after web retrieval failed. TypeSafe primary HTML used because Markdown retrieval is unreliable. No request to model/catalog/account endpoints.
- **Focused checks:** Initial documentation assertion caught the missing child access date; fixed before handoff. Final command below exited 0: four files, 16 valid relative links, two parseable synthetic JSON envelopes, nine required sections. No provider runtime test performed.
- **Failure/privacy:** Fixed authorized endpoint/binding, no ambient credentials/cloud fallback, finite body/deadline/concurrency budgets, source-specific confidence and explicit uncertain/error/cancel outcomes. Inference cancellation does not imply remote/worker compute cancellation.
- **Unblockers:** Accept candidate transport/budget/data-minimization policy; select version-pinned general Laya deployment/checkpoints; approve provider terms/egress and harmless compatibility scope; finish prerequisite handoffs; then assign047/049. The browser checkpoint cannot prove general decisions.

Exact focused documentation command:

```sh
bun -e 'import { existsSync } from "node:fs"; import { dirname, resolve } from "node:path"; const files = ["docs/decisions/jev-laya.md", "docs/decisions/hermes-memory.md", "tasks/046a-identify-decision-products.md", "tasks/054a-record-hermes-memory-contract.md"]; let relativeLinks = 0; let jsonFixtures = 0; for (const file of files) { const text = await Bun.file(file).text(); if (!text.includes("2026-10-22")) throw new Error(`Missing date: ${file}`); for (const match of text.matchAll(/\]\(([^)]+)\)/g)) { const target = match[1]; if (/^https?:/.test(target)) continue; if (!existsSync(resolve(dirname(file), target.split("#")[0]))) throw new Error(`${file}: missing ${target}`); relativeLinks += 1; } for (const match of text.matchAll(/```json\n([\s\S]*?)\n```/g)) { const fixture = JSON.parse(match[1]); if (!fixture.model || !(fixture.questions || fixture.answers)) throw new Error("Invalid fixture envelope"); jsonFixtures += 1; } } const decisions = await Bun.file(files[0]).text(); const memory = await Bun.file(files[1]).text(); for (const section of ["Jev wire contract", "Laya: two different server surfaces", "Deployment recommendation", "Normalized outcomes"]) if (!decisions.includes(section)) throw new Error(`Missing decision section: ${section}`); for (const section of ["Exact upstream mechanism", "Options and decision", "Snapshot and harness interoperability", "Provenance, deletion", "Synthetic lifecycle"]) if (!memory.includes(section)) throw new Error(`Missing memory section: ${section}`); console.log(JSON.stringify({ files: files.length, relativeLinks, jsonFixtures, requiredSections: 9, passed: true }));'
```
