# RFC-008a independent design review

Date: 2026-10-22. Design acceptance only.

- codeQualityStatus: CLEAR
- recommendation: APPROVE
- blockers: [] for the proposed design and its next bounded source slice
- Production launcher, Linux provisioning, deadline/cleanup guarantees and RFC-008/010 operational acceptance remain incomplete.

## Findings by severity

- CRITICAL: none.
- HIGH: none.
- MEDIUM: none.
- LOW: none.

No fatal feasibility, authority or scope-boundary defect was found in the selected linux-systemd-v1 proposal. Acceptance requires preserving its fail-closed capability checks and conservative unknown-state semantics; it is not approval to claim the existing macOS Docker endpoint is an implementation of this profile.

## Source and evidence reviewed

Read `docs/decisions/runtime-supervisor.md`, `tasks/008a-design-isolated-launcher.md`, stable and active-attempt runtime-008a reports, source inventory, input/output hash manifests and document-link checker/receipt. Consulted the accepted isolation, connection-secret, harness and browser boundaries, current pure harness/tool contract, the standalone recovery source, and RFC-009/010 ownership definitions. The standalone probe remains research source, not a production launcher to import wholesale.

Independently verified both final hashes:

```text
fb65f0cb219e8f3161b17a537f575e43f31919a7bc939d35b6ca51429eee5e66  docs/decisions/runtime-supervisor.md
52cdb4120baa8308c0dbc5782b509478d64f89640954e6a7d1c997a499b5aa04  tasks/008a-design-isolated-launcher.md
```

The 12-reference inventory records URLs and claims, not full upstream content. Therefore this reviewer independently opened the critical official systemd, Docker daemon-security/stop/internal-network/nftables and RFC9110 sources. The review does not pretend all 12 references were independently fetched. Source-supported facts and engineering inferences are separated below.

## Feasibility and authority assessment

**Independent deadline owner:** systemd documents runtime limits for long-running services, post-stop cleanup including unexpected exits/failed startup, and process termination escalation. A separate managed runner can therefore remain independent of the API process; `Type=exec` itself confirms executable startup, not application readiness. The ADR separately requires prepared-resource inspection, so these are not conflated. The Linux-host experiment must demonstrate the actual unit, helper, journal and Docker behavior; these manuals do not establish a configured deadline guarantee. [systemd service reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)

**Container termination:** Docker stop sends a selected signal to the main process and escalates to SIGKILL after a finite timeout. The ADR correctly distinguishes that operation from killing a Docker CLI/systemd client process and requires exact container/tree verification. [Docker stop](https://docs.docker.com/reference/cli/docker/container/stop/)

The fixed runner must be a host-managed service, not a client-owned scope that disappears with the control connection. Provisioning must measure the whole deadline plus stop/helper cleanup interval; RuntimeMaxSec expiration is not synonymous with container removal. If a pending daemon operation cannot be settled or the helper cannot confirm removal, the existing ADR's quarantine/cleanup=false semantics apply. Keep capacity and leases reserved, including when a delayed create/start appears after cancellation. Do not weaken that condition to make a finite happy-path test pass.

**Closed control API:** dedicated mTLS authenticates only the trusted dispatch service; user/actor authorization remains server-derived. Limits on body size, framing, input bytes, requests, global/per-actor attempts and answer time are concrete. Prepare/activate separation, exact descriptor identity, monotonically fenced input and no retransmission after uncertain delivery prevent automatic replay. Receipt/status IDs are not grants. No model-selected host path, image, executable, mount, environment map, unit property or raw Docker request exists in the initial contract. Keeping Docker authority in the launcher domain is warranted because daemon credentials permit host-root authority. [Docker socket security](https://docs.docker.com/engine/security/protect-access/)

**Journal ownership and failure states:** intent is durable before runner/daemon effects; operation intent/result and cancellation survive control-service death. Random ownership labels, exact names/IDs, immutable descriptors and one writer are a coherent cleanup boundary. Unknown pending operations do not become absent because one query finds nothing. The design correctly blocks adoption/prune, caller-supplied settlement flags, lease reuse and second launches while a prior attempt is unresolved. Permanently unknown state is an explicit repair outcome rather than a fabricated cleanup success. This is a resource ledger, not another queued-work dispatcher.

**One durable dispatch authority:** RFC-009/010 exclusively owns queued work, run/attempt states, claims, fences, grants and logical terminal outcomes. Local launcher ceilings do not mint DB authority. RFC-007's lock order and issued-before-delivery semantics remain intact; no database lock spans an external launcher call. Unknown commit discards plaintext; uncertain delivery cancels/reconciles without resend. The first fixture recipe has no credential field at all. Future recipe-specific delivery requires its own reviewed extension and actual proof.

**Egress:** the proposal correctly retains network=none for the first recipe. Internal Docker networks still allow gateway-host communication, so future bridge isolation requires explicit host and forwarding policy. The nftables backend lacks DOCKER-USER and needs separate hooks/tables; the deployed backend/version must be pinned. [Docker internal network](https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode---internal), [Docker nftables](https://docs.docker.com/engine/network/firewall-nftables/)

CONNECT becomes a byte tunnel after establishment, supporting the ADR's limitation that encrypted paths, account operations and stronger origin claims cannot be enforced by destination allowlisting alone. Reverse-provider gateways remain candidates only where the pinned native client supports them; no TLS-verification disabling or unrestricted fallback is accepted. [RFC9110 CONNECT](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.6)

**GUI separation:** code-execution attempts have no GUI sockets, raw addresses, shared profiles or broker credentials. Browser/computer observations and input require the separate actor/lease/epoch-authorized broker, including the takeover barrier. Neither provider egress nor a launcher forwarding API creates a bypass. GUI recipes/viewers are explicitly absent from this first slice.

**Current host limit:** Docker/Colima reachability from macOS proves neither service-manager access on the Docker host nor a provisioned private journal, runner or helper. The ADR explicitly denies prepare when these capabilities are unavailable. That is a realistic provisioning gate, not an architecture defect or permission to silently use a Bun timer fallback.

## Exact next bounded path

First assign source-only LaunchSpec validation, fixed fixture recipe expansion and journal state transitions, with injected I/O. A suitable small module split is `launch-spec.ts`, `fixture-recipe.ts` and `launcher-journal.ts` plus focused tests; final names remain the implementer's choice. Reuse existing RunContext and error/uncertainty semantics. Do not implement HTTP/TLS, Docker invocation, systemd control, scheduling, credentials, egress or GUI in that source slice.

Prove rejection of unknown authority fields, malformed/duplicate keys at the actual JSON boundary, stale fence, changed-descriptor retry, expired deadline, image/env/path injection and terminal replay. Exercise crash points around intent/result persistence, lost create/start responses, delayed acknowledgment after cancellation, corruption, duplicate activation and uncertain input delivery. A fake successful Docker result cannot establish real cleanup.

Then separately choose/provision the exact Linux host and service-manager/Docker versions, dedicated CA/client identity, private durable journal root, fixed unit/runner/helper, and a reviewed no-network fixture image with immutable digest. Prove A/B isolation plus API SIGKILL, runner SIGKILL, runtime deadline, TERM resistance, output/backpressure, daemon stall, delayed operations and reboot reconciliation. Preserve unrelated resources and require exact cleanup receipts. Only after that accepted fixture profile should RFC-009/010 integrate the single DB authority; networked provider/native and GUI work remain separate gates.

## Skill perspective and verification limits

Applied code-review-and-quality, programming/TypeScript and remove-ai-slops perspectives already loaded in this review. This is a documentation proposal: no production abstraction/parser or behavioral test was introduced. Its future schema and journal complexity corresponds to actual trust/crash boundaries; no speculative second queue or generic process API is selected. No skill-perspective violation identified. No prose-marker tests were required.

Independently ran the read-only document-link checker: 23 local targets across four documents exist, exit 0. Hash verification also passed. These are integrity checks, not systemd, Docker, mTLS, provider or failure-recovery proofs. No service/container/account/install/Git/product-code mutation was performed. Only this review and `G002.../a1/runtime-008a-independent-review.md` were written.
