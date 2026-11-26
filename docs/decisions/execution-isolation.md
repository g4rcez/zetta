# Execution isolation

Status: supported no-network research/design accepted under the user's delegated architecture authority after independent design and final readiness review. **RFC-002 may supply the pure RFC-006 contract prerequisite; real-account execution remains blocked on the owning runtime, secret, egress and native integration proofs.** Research acceptance is not operational acceptance of a product supervisor or all six harnesses.

## Decision and trust model

Use a Linux container host. Local macOS development may use Docker's Linux VM; this does not claim native macOS process containment. A separate trusted launcher owns per-attempt sandboxes. Never run autonomous CLIs in the application server's privilege domain. Reuse the installed Docker CLI for the first synthetic proof; do not add a Docker SDK or paid sandbox service.

Trust the application authorization service, launcher, host/VM kernel, Docker daemon and installation operator. Treat model-generated code, native tools and attempt output as hostile. Shared-kernel containers do not protect against kernel exploits or a malicious operator. The installation admin product role still has no private-content bypass.

The current server image and Compose service carry application privileges and are not least-privilege execution images. A separate working directory, HOME, shared worker container or prompt instruction is not a sandbox. Only the trusted launcher may hold Docker authority; neither the app nor an attempt receives the Docker socket or daemon credentials.

## Actor and state boundary

- Derive actor, membership, configuration and authorized resources in the app. Delegation preserves the initiating actor; schedules use the routine owner. A shared bot never supplies its owner's private connections or state. Workspaces are visual groups, not security boundaries.
- Give the launcher a validated logical run/attempt descriptor, not caller-controlled image names, executable paths, host mounts, Docker arguments or network settings. Exact control-channel/API work remains in its dependent implementation tasks.
- Keep actor+harness native state separate. Mount only explicitly selected actor-owned inputs/state, never a parent holding all users. Native sessions and browser profiles require exclusive leases unless verified safe same-actor sharing is explicitly configured. Never reuse another actor's scratch or stale session.
- Exclude host HOME, SSH/cloud stores, app source/config, DB/auth/logging secrets, privileged devices, host namespaces and host desktop sockets. Keep attempt scratch ephemeral and bounded. Persistent state is separate from scratch.
- Resolve minimum connection references through a narrowly authorized trusted channel. References alone grant no authority. Exact secret storage remains RFC-007 work; this decision does not approve plaintext persistence or a global credential fallback.
- Inject only actor-authorized credentials through supported minimal channels. A credential supplied to a CLI may be read by malicious code in that attempt; a private file is not protection from that same code. Prefer short leases and provider revocation. Never place app-wide secrets in an attempt.

## Enforceable launch policy

Use a fixed approved runtime image and entrypoint, non-root UID, dropped capabilities, no-new-privileges, read-only root, private PID namespace, bounded writable scratch and selected read-only inputs. No privileged mode, host namespaces, devices, daemon socket, broad writable host mount or published port. Inspect the created configuration before starting fixture code; unsupported required settings are a failure, not a fallback.

The first synthetic proof uses `network=none`. Real provider/public-browser access is blocked until enforceable egress policy is demonstrated. Cover private/control networks, host gateway, metadata endpoints, DNS, redirects, IPv4/IPv6 and proxy bypass. A shared Compose network or environment proxy alone is not enforcement. Later public browsing still must not gain private-network access.

The launcher owns finite wall-time, CPU, memory, PID, scratch, output and concurrency budgets; cancellation/escalation, complete owned-process-tree termination, cleanup and orphan reconciliation. An interrupted attempt must not silently replay an uncertain external action. Membership/connection revocation denies new dispatch and tool actions, closes streams/input, and cancels active work best-effort; it cannot undo completed actions or recall copied credentials.

Host-tool invocations bind to server-derived actor/run/attempt and authorized capabilities. Validate bounded arguments/results, reject replay/foreign resources, and reauthorize before side effects. Keep hostile output privately bounded for assertions; export fixed categories and metadata, never uncontrolled stderr, commands, env, credential-entry frames or secrets into app/Axiom logs.

## Browser and computer use

Both remain required v1 deliverables. A browser profile is not a full desktop boundary.

- Browser: actor-owned cookies, downloads and profile process state; authorized bindings and exclusive profile leases; no cross-user fallback.
- Computer: isolated actor-owned display, input, clipboard and file state; authenticated short-lived takeover; pause automation during takeover; suppress credential-entry frames from model context, logs, screenshots and learning. Never expose the host desktop/display socket as fallback.
- RFC-074 must verify concrete backends, versions, OS support and takeover transport. Six-harness compatibility, native login relocation, browser and desktop evidence are separate gates; unsupported required paths block release rather than reduce scope.

## First proof plan and acceptance limits

Implement only a standalone synthetic launcher/probe fixture outside app startup, without importing application services or environment loaders. This bounded research fixture is part of RFC-002, not a bypass of RFC-006/008 dependencies or production launcher acceptance.

1. Pin an already-local runtime image by ID/digest. Use synthetic actor A/B homes, sessions and fake-host canaries; no real account, host secret, provider or database is needed.
2. Require successful authorized A reads as a positive control. Deny B/fake-host paths through absolute paths, traversal and symlink chains; deny foreign state selection, environment/process inspection and foreign-process signaling. Inspect mount policy without reading real host files.
3. Use finite bounded child spawning, deadline/cancel escalation, output overflow and scratch exhaustion. Verify B is unaffected, scratch is not reused and owned resources are removed. Record restart/orphan behavior separately.
4. Record exact runtime/image versions, launch policy, commands, expected/actual booleans, exit status and cleanup. Do not export canaries or raw hostile output. A failed positive control or unsupported setting is blocked evidence, never a passing denial.
5. Remove only exact owned fixture containers and temporary paths. No prune, wildcard removal, persistent database/volume cleanup or unrelated container operation.

Initial proposed budgets: one CPU, 128 MiB memory, 32 PIDs, 16 MiB scratch, 64 KiB captured output, 15 s per attempt and at most two active synthetic actors. Confirm support before execution; these are probe limits, not production tuning. Runtime probes are bounded to this synthetic Docker research under delegated infrastructure authority; no real account or network-enabled run is authorized by this document.
