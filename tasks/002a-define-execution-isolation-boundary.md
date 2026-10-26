# RFC-002a: Define the execution isolation boundary

- **Parent:** [RFC-002](002-prove-multi-user-execution-isolation.md).
- **Prerequisite:** accepted ownership policy and user-delegated deployment/architecture choice.
- **Status:** design direction accepted; runtime proof pending. Parent/root remain incomplete.

## Goal and scope

Select a concrete least-privilege deployment direction and bounded synthetic proof plan before real account execution. No production launcher/API, schema, dependency install, app build or real provider/desktop access.

## Accepted contract

[Execution isolation decision](../docs/decisions/execution-isolation.md): Linux container host, including VM-backed Docker on macOS; separate trusted launcher outside app privileges; isolated per-attempt units; immutable actor, private native state and authorized credential bindings; no app/daemon/host secrets in attempts; initial synthetic `network=none`; real-run egress, six harnesses, browser and full desktop proof retained as separate gates. Trusted operator/kernel/daemon limits are explicit.

The user delegated the baseline choice to the coordinator. No further owner selection is required for these design defaults. Independent read-only review found no issues, accepting direction only. Docker availability and local image identity are observed facts, not containment evidence.

## Acceptance and evidence

- [x] Source inventory compares in-app spawning with a separate constrained launcher and rejects HOME/workdir-only containment.
- [x] Private actor/state/credential, host-tool, network and lifecycle contracts documented without changing production behavior.
- [x] Synthetic two-user proof plan and browser/desktop limits recorded; real runs blocked until required proof.

Changed paths: decision document, this child, parent RFC-002 completion/status and root row. Review receipts: `/tmp/zetta-rfc002-isolation-proposal.md`, `/tmp/zetta-rfc002-isolation-design-review.md`. Coordinator observed Compose 5.6.0/Linux Docker 29.5.2 and inspected already-local Bun image identity; no sandbox was started for this child. No LSP applies to Markdown; local-link/whitespace checks are required after documentation edits.

## Handoff

Implement a standalone bounded synthetic fixture under parent RFC-002, pinning the local Bun image and confirming security policy before fixture start. Save exact safe results and cleanup evidence. Do not mark parent Done from design acceptance or unblock production adapter/supervisor dependencies. Secret storage, real provider egress, harness state, browser and desktop remain unproved.
