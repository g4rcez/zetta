# RFC-074a: Research isolated browser and full-computer backends

- **Parent:** [RFC-074](074-select-required-browser-and-computer-backends.md), operationally incomplete.
- **Status:** Bounded candidate research accepted after independent CLEAR/APPROVE review; no backend accepted as operational.
- **Scope:** `docs/decisions/browser-computer.md`, this handoff and active-attempt evidence only.

## Authority and inputs

The coordinator assigned bounded read-only research under the user's authorization to continue remaining v1 work, explicitly allowing early research before actual six-harness prerequisites finish. Read supplied AGENTS instructions (no root AGENTS.md exists), tasks README/plan, confirmed intent, RFC-074/006, accepted ownership/isolation, harness compatibility, connection-secrets ADR and actual RFC-006 host-tool source. No implementation, infrastructure start, download/install, model/account call, host-profile inspection, schema/env/manifest or Git mutation is authorized by this slice.

## Completion record

Changed: [backend decision](../docs/decisions/browser-computer.md) and this file. Exported recommendation: agent-browser 0.39.1 source pin for web; MIT Cua Driver 0.38.0 standalone MCP on isolated Linux X11, with separate TigerVNC/noVNC/websockify viewer candidates. Cua Spaces 0.7.0 media stack is explicitly FSL-1.1-MIT and unselected. No use of host CUA tool availability as deployment permission. The ADR records transport versions, all-six-harness bridge candidates, ownership, secret takeover, cancellation/restart, egress, persistence and future observable probes.

Evidence directory: `local evidence`.

| Research criterion / invocation                                                                                  | Binary observable / artifact                                                                                                                                                                                                                             |
| ---------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Fetch current primary source commits and pinned files through `mcp__codex_apps__github_fetch({url})`             | Nonempty pinned source text with manifests/licenses/protocols; `sources.json` and `viewer-sources.json` (36 receipts). Exact URLs are retained per entry as repo+SHA+path.                                                                               |
| Inspect `ALL_TOOLS` metadata only for CUA/driver interfaces                                                      | No host tool invocation; distinction between host tools and deployable source documented in ADR and `review.md`.                                                                                                                                         |
| Review browser/full desktop, all six bridge paths, secret-entry and lifecycle boundaries against local contracts | Explicit proposed/observed/blocked distinctions and acceptance mapping in `review.md`; all operational scenarios remain unexecuted.                                                                                                                      |
| `bun --no-env-file run <evidence-dir>/check.ts`                                                                  | Every assigned markdown local link resolves, every source receipt is nonempty with a full SHA, expected version/source files exist; `check.json` records true booleans and document/source hashes. This is document integrity, not backend verification. |

Public shell fetch failed with DNS resolution denied; continued through the available GitHub connector without escalation. A guessed standalone trycua/cua-driver repository returned 404; verified the actual monorepo path instead. `command -v` found agent-browser and cua-driver, but installed versions/runtime behavior were deliberately not used as image compatibility proof. No service/account/state commands ran. Biome LSP is unavailable and installation was not attempted; markdown and captured JSON are checked by the narrow Bun integrity check.

Next: coordinator review of this recommendation, then separate provisioning/adapter/profile/takeover assignments in RFC-075–078 with RFC-008/010/012–018. RFC-074 and v1 remain incomplete until accepted live browser **and native desktop** proofs, all six harness exposures, egress, secret suppression and recovery pass. No production capability is unblocked solely by these documents.
