# Isolated runtime supervisor

Status: bounded design accepted for source implementation after [independent CLEAR/APPROVE review](../verification/reviews/runtime-008a-review.md), 2026-10-22. This ADR does not complete RFC-008, RFC-010, native harness compatibility, or deployment provisioning. First authorized child008b implements only the strict LaunchSpec and fixed recipe; it starts no runtime or service.

## Decision and evidence boundary

Use a separate trusted Linux launcher with a small authenticated control API. Select one deployment profile, linux-systemd-v1: the launcher, fixed runner unit and cleanup helper run on the same provisioned Linux host as Docker. The server sends an immutable attempt descriptor; the launcher expands an operator-approved recipe into Docker configuration and owns resource cleanup. Only this launcher trust domain has Docker authority. PostgreSQL remains the sole durable run/dispatch authority.

This profile is not supported by merely pointing a macOS launcher at Docker Desktop/Colima's socket. The existing local Linux VM/daemon does not establish access to its host service manager, persistent journal or runner template. A macOS app may later call the provisioned Linux control plane over mTLS; exercising that integration requires separate Linux-host provisioning. At startup, missing supported systemd, installed fixed runner/helper, durable journal root, Docker resource controls or cleanup authority returns capability_unavailable and denies prepare before resource creation. There is no plain-Bun timer or Docker-CLI-kill fallback. An independent trusted watchdog could be another profile only after separate ownership/persistence/crash proof; it is not selected here.

Observed in current source: [harness.ts](../../apps/server/src/modules/runtime/harness.ts) has bounded actor/run/attempt context and an async event/cancel contract; [host-tools.ts](../../apps/server/src/modules/runtime/host-tools.ts) classifies post-callback failures conservatively. The [probe](../../scripts/execution-isolation-probe.ts) uses a fixed Bun image, Docker CLI, non-root container, network none, bounded scratch/resources, config inspection and exact-resource removal. The [recovery fixture](../../scripts/execution-isolation-recovery.ts) fsyncs a private journal before launch and rejects unsettled create reconciliation; it is explicitly standalone synthetic code. Its permissive inspection typing, fixture paths, caller-supplied settled flag and hardcoded development endpoint are not production APIs.

The accepted [isolation ADR](execution-isolation.md) reports prior synthetic proofs. They were not rerun for this design. [Connection storage](connection-secrets.md) requires committed single-use dispatch grants before credential delivery; full resolution is still pending. [Harness compatibility](harness-compatibility.md) provides candidate native protocols, not working Linux images. [Browser research](browser-computer.md) requires a separate GUI sandbox. Everything below is a proposed contract/inference unless explicitly attributed to a primary source.

## Trust and control transport

Select HTTPS with mutual TLS between the trusted app dispatch service and launcher. Use a dedicated installation CA, pinned launcher identity, an allowlisted client certificate identity, certificate expiry/revocation checks, TLS 1.3, and a private control interface/firewall. Do not reuse user cookies, connection encryption keys, provider credentials or Docker certificates. The app authenticates users and freshly authorizes dispatch; mTLS authenticates that trusted service, not a model-supplied actor field. Requests from browsers, attempt networks and unrecognized client identities fail before body processing. No raw Docker proxy API is exposed.

Docker stays on a launcher-local Unix socket selected from operator configuration, with an explicit CLI binary and isolated CLI HOME/DOCKER_CONFIG. No context discovery or environment inheritance. Docker documents that daemon-client certificates confer host-root-level authority; that is why the application receives only the closed launcher API. [Docker socket security](https://docs.docker.com/engine/security/protect-access/)

Bound controls to 16 KiB JSON, 5 seconds to read/answer, at most two active fixture attempts globally and one per actor, and 32 pending authenticated control requests. Reject unknown fields, duplicate JSON keys, extra content, noncanonical IDs and out-of-range integers. No request/response bodies, TLS keys, stdin/stdout/stderr, private paths or daemon error strings enter access/application logs. Export fixed failure codes, safe attempt/operation IDs and byte counts. Development must use the same authentication boundary; plaintext/localhost fallback is not an accepted production path.

Proposed private API, not an added public route:

| Operation | Closed request | Response / repeat semantics |
| --- | --- | --- |
| POST /v1/prepare | LaunchSpec below | receiptId and resource phase; same attempt + identical descriptor returns the existing receipt, never a second resource. Changed descriptor is conflict. |
| POST /v1/activate | receiptId, leaseId, fence, activationId | Only prepared current lease may activate once. Receipt means admission, not successful execution. An uncertain response requires status reconciliation, never another activation. |
| POST /v1/input | receiptId, leaseId, fence, inputId, sequence, base64 bytes, eof | One serialized input stream; sequence must be last-admitted + 1, decoded frame <= 8 KiB and aggregate <= 64 KiB, fitting the 16 KiB JSON body after base64 encoding. Journal ID/sequence admission before forwarding; old/repeated sequence is rejected without writing bytes, and response loss never causes automatic retransmission. |
| POST /v1/cancel | receiptId, leaseId, fence, reason from owner/deadline/revocation/shutdown | Persist cancellation first; idempotent stop intent. Success is returned only after confirmed tree stop, otherwise stopping or quarantined. |
| GET /v1/status/{receiptId} | authenticated service; exact receipt ID | Fixed phase, ownership tuple, policy version, sequence and termination/cleanup facts. Unknown receipt is unknown, not proof of no launch. |
| GET /v1/output/{receiptId} | authenticated service; one active consumer | Bounded private framed stdout/stderr/control stream. No replay/history promise; disconnect cancels the attempt and closes admission. |

For initial fixture activation there are no credentials, native state or GUI channels. Later credential delivery extends activation with a specifically reviewed grant-bound transient payload; no generic secret, mount or environment map is reserved in version 1. Reject unsupported fields now. Later server-owned parsers consume stdout/control and normalize RFC-006 events; launcher bytes are not trusted events.

## Closed LaunchSpec and recipe expansion

Use strict Zod at the control boundary and readonly internal types. Fields are:

| Field | Required constraint |
| --- | --- |
| version | literal 1 |
| context | existing RFC-006 RunContext; same ID regex [a-zA-Z0-9_-]{1,128}; trusted server-derived actor/run/attempt/configuration identity |
| leaseId | opaque ID, same bounded alphabet; immutable per attempt |
| fence | safe positive integer, server DB-issued monotonic generation |
| recipe | literal fixture-v1 in the first implementation |
| fixtureCase | enum echo, wait, fork, term-resistant, flood; fixed fixture behavior only |
| policyVersion | exact operator-installed recipe version; no caller policy content |
| deadlineEpochMs | safe positive integer, no more than 60 seconds ahead; must also fit the app's authorized absolute deadline |
| budgets | deadlineMs 1..60000; maxInputBytes 1..65536; maxOutputBytes 1..65536; maxFrameBytes 1..8192, no greater than aggregate; otherwise fixed resource policy below |

All fields contribute to an unambiguous canonical descriptor digest, excluding no authority-bearing field. Persist the descriptor and digest, not prompt text. Expiry never extends on retry or reconnect. Enforce monotonic elapsed-time limits during life; after reboot use the persisted absolute deadline and fail closed on invalid/backwards clock or unavailable time confidence. For a run with an unresolved prior attempt, a higher fence does not authorize a second launch. Old fence commands cannot send input or activate; cancellation intent from the current owner is reconciled against the exact recorded resource.

Recipe expansion is a launcher-local, finite table, not caller executable/argv templating:

- Pin the complete execution image by immutable digest, with no pull/build at dispatch. The earlier Bun image digest only proves the old probe base; a fixture-v1 image containing its reviewed fixture program must be built and pinned separately.
- Entrypoint is exactly /usr/local/bin/bun; argv is exactly --no-env-file, /opt/zetta/fixture.ts, then the validated fixtureCase. No shell, eval string, caller CLI flags, command substitutions, model-selected executable or image tag.
- Fixed environment: PATH=/usr/local/bin:/usr/bin:/bin, HOME=/scratch/home, XDG_CONFIG_HOME=/scratch/home/.config, XDG_CACHE_HOME=/scratch/cache, LANG=C.UTF-8. Inspect the image for extra Env and reject unexpected defaults; do not silently merge inherited image/application environments.
- Initial bootstrap working directory is /scratch. The fixed trusted fixture entry program creates owned0700 home/work subdirectories within the dedicated16MiB tmpfs, then changes to /scratch/work before admitting untrusted work or input. Container UID/GID65534:65534; root read-only; drop all capabilities; no-new-privileges; default supported seccomp; private PID/cgroup namespaces; IPC none; no host UTS/user namespace shortcuts. The coordinator's actual pinned-Bun-base probe showed that selecting /scratch/work directly starts but Docker creates it root-owned0755 and unwritable to65534; [retained probe](../../.omo/evidence/ulw/01a1643f-531d-7590-aec8-a8624a8fa202/G002-use-bun-typescript-and-the-installed/a1/coordinator-cwd-probe.md). Child008b1 corrects this policy and must prove writable bootstrap. This does not certify the unbuilt final execution image.
- One CPU, 128 MiB RAM with matching memory+swap cap, 32 PIDs, restart=no, log-driver=none, healthcheck disabled, network=none, no exposed/published ports/devices/extra hosts/links. Scratch noexec,nosuid,nodev; no bind mounts in this initial image. Runtime code creation/execution may still be possible through interpreters; noexec is not a code prohibition.
- Docker create then inspect the exact ID, labels, image, command, environment, namespaces, limits, writable paths and network settings before start. Unexpected image volume declarations or settings fail closed. No Docker socket, host HOME, repository/app config, DB key, host credential directory, GUI socket or another actor's storage is reachable.

Future native recipe IDs each need pinned Linux binary/image/architecture, exact finite argv construction, private home/session layout and tested capability support. Profile/workspace bindings must be opaque owner-leased references resolved by launcher inventory into exact owned leaves; never accept host paths, archive uploads, a parent containing other users, or arbitrary mounts. Native profile persistence remains disabled until encryption-at-rest, exclusive ownership and crash/restore behavior are accepted.

## Resource ownership, bounded lifetime and recovery

The launcher journal is a resource ledger, not a runnable-work queue. Use one protected installation root, private per-receipt directories, no symlink traversal, exclusive single-writer ownership and atomic write + file fsync + rename + directory fsync. Check journal schema/version, owner, mode and descriptor digest before acting. An invalid journal blocks new admission on that launcher until reconciled; it does not authorize wildcard cleanup.

Minimum durable fields: installationId, receiptId, context IDs, leaseId/fence, descriptor digest, recipe/policy version, exact generated container name, random ownership label, acknowledged full container ID if known, host runner unit ID, deadline, phase, pending Docker operation ID/type, cancellation intent, last admitted input ID/sequence, terminal fact and cleanup state. Phase is the closed enum intent, creating, prepared, starting, running, stopping, stopped, quarantined. Cleanup is pending, confirmed or unknown; stopped does not itself mean cleanup confirmed. No credentials, output, prompt, user labels or global host paths. Retain terminal tombstones until RFC-010 acknowledges terminal ingestion and its retry horizon expires; retain unresolved records indefinitely for repair.

Prepare allocates receipt and name and commits prepared-intent before any Docker I/O. Start a dedicated host-owned attempt runner under a bounded systemd unit, so the control service crashing does not remove the deadline owner. It serializes create/inspect/start/stop operations, waits for activate after verified creation, and owns pipes. Persist each operation intent before issuing it and its result before replying. No unrecorded create/start/credential handoff.

Proposed host lifecycle guard: fixed unit template with Type=exec, Restart=no, RuntimeMaxSec bounded by remaining deadline, TimeoutStartSec=5s, TimeoutStopSec=5s, KillMode=control-group, and a fixed ExecStopPost cleanup helper taking only the validated receipt ID. Application/model fields cannot set unit properties or executable text. The helper reads the journal and removes only an exact ownership-verified container after outstanding daemon operations settle. Killing a Docker CLI or its systemd cgroup alone does not kill the container. systemd documents RuntimeMaxSec and cleanup on abnormal startup/exit; applying these to the launcher is an engineering proposal requiring a Linux host proof. [systemd service reference](https://www.freedesktop.org/software/systemd/man/latest/systemd.service.html)

The runner enforces the absolute deadline, aggregate stdout+stderr byte cap, bounded frame buffer, 10-second maximum blocked consumer, and closure of all owned descriptors. On cancel/deadline/overflow/parse failure: stop new stdin/host tools, persist stop intent, request native interrupt only if its pinned adapter supports it, then explicit container SIGTERM with at most 2 seconds grace followed by SIGKILL/exact-ID removal. Verify stopped state and owned tree absence; preserve B and unrelated resources. Docker stop signals the main process and escalates after its timeout; process-tree containment needs the actual container proof, not a CLI exit code. [Docker stop](https://docs.docker.com/reference/cli/docker/container/stop/), [Docker kill](https://docs.docker.com/reference/cli/docker/container/kill/)

| Persisted/observed state | Required action after reconnect/restart |
| --- | --- |
| Intent recorded, create not submitted with authoritative local proof | Report not-started; cancel/discard owned scratch; RFC-010 may decide a fresh attempt. |
| Create/start pending, response lost, daemon query inconclusive, or submission may still complete | quarantine, no replay and no lease reuse. Missing container in one query is not proof of absent effects. Keep journal/capacity reservation; settle the outstanding operation before destructive cleanup. |
| Created and policy verified; no activate admitted | Remain inert or remove exact owned resource on expiry/cancel. A stale activation is rejected. |
| Start acknowledged or running found with matching receipt/name/label/config | Preserve uncertain execution state; current fenced owner may cancel/reconcile. Never restart it as a new run or infer success from process disappearance. |
| Input/credential admission acknowledged but delivery completion unknown | Mark delivery uncertain; close input and cancel. Do not resend bytes, mint a new grant, or infer no effects from missing output. |
| Exited with complete privately delivered protocol terminal | RFC-006 adapter validates terminal; RFC-009/010 commits logical outcome. Launcher reports only process/cleanup facts. Exit 0 alone is insufficient. |
| Journal/ownership mismatch or unknown labelled resource | No adoption, broad prune or deletion. Quarantine exact discrepancy and stop affected launcher admission. |
| Stop/removal cannot be confirmed | cleanup=false, retain quarantine and exclusive profile/attempt leases; no success or safe-to-retry claim. |

On launcher startup, refuse admission until its closed journal is scanned and acknowledged resources reconciled. Enumerate only this installation's labels; verify full IDs and matching descriptors before cleanup. Cancel any running orphan whose DB ownership cannot be revalidated. Never trust a caller boolean that says creation settled. A launcher restart cannot reconstruct undelivered output; report interrupted/uncertain and reconcile rather than reattach and claim continuity.

Availability boundary: systemd and Docker must be healthy for enforced cleanup. If the daemon/kernel or host manager is unavailable, retain uncertainty and isolate/fence the node; do not claim a hard stop bound or schedule replacement against its leased state. A fully unavailable host cannot attest cleanup. Native persistent state remains quarantined after unclean termination.

## One dispatch authority: RFC-007, RFC-009 and RFC-010

RFC-009 owns PostgreSQL run/attempt identity, idempotency, immutable actor/configuration snapshots and legal terminal transitions. RFC-010 owns claims, lease/fence issuance, per-user/global concurrency, durable cancellation, grant records and reconciliation. The launcher has local admission ceilings and a journal of resources it already owns; it cannot select queued work, invent actor authority, advance a logical run, renew DB leases or automatically retry an attempt.

Proposed order for the later integration:

1. RFC-010 claims one attempt transactionally, with immutable context and fencing token; obtains fresh membership/resource authorization. Prepare the inert launcher resource using that identity.
2. RFC-007 checks pinned connection ownership/version/state/expiry inside the accepted membership -> sorted connection rows -> dispatch-grant lock order. RFC-010's shared dispatch record is the grant; no second lease table/service in RFC-007.
3. Decrypt in the bounded issuance operation and commit issued before external delivery. Unknown commit discards plaintext and prevents activation. No DB locks span launcher calls.
4. Deliver the minimum bytes once over the authenticated channel to that receipt, within the earlier of 30 seconds or the attempt deadline. The launcher uses a recipe-specific non-logged transient channel, never command arguments or persistent journal. Unknown receipt/delivery stops and reconciles; it never automatically issues/resends. No generic environment secret injection in version 1.
5. Revoke/removal ordered before issuance blocks it; ordered after issuance persists cancellation and closes all mediated input/tool channels. Best-effort abort cannot recall copied provider credentials. Host-tool effects require fresh authorization and durable invocation uncertainty under RFC-010 before execution.

No dependency cycle: accepted RFC-007 storage/encryption/ownership contracts and the secret-free RFC-006 interface permit RFC-008's synthetic launcher slice. Full RFC-007 dispatch resolution is accepted only with RFC-008/010 integration. RFC-008 does not depend on a completed real credential launch to define or prove its no-secret boundary; RFC-010 still depends on accepted RFC-008/009. This ADR proposes schema ownership only and authorizes no schema change.

## Egress choice and TLS limits

Network none is the mandatory first recipe. Docker documents that only loopback is present; this proves no provider connectivity, not six-harness compatibility. [Docker none driver](https://docs.docker.com/engine/network/drivers/none/)

Prefer a separately trusted provider gateway for the later networked proof: each attempt has a dedicated internal bridge with exactly itself and its gateway interface, no direct external attachment, no published ports and host firewall rules allowing only the gateway service port. Explicitly block the bridge gateway/host services, app/launcher/DB/control networks, metadata, loopback aliases, link-local/private/reserved addresses, cross-attempt traffic, direct DNS and IPv6/UDP/QUIC unless separately enforced. Docker internal networks still permit bridge-gateway host communication, so internal alone is insufficient. [Docker internal network semantics](https://docs.docker.com/reference/cli/docker/network/create/#network-internal-mode---internal)

The trusted gateway owns DNS resolution, validates every resulting address and connects to the validated address without a second uncontrolled lookup. Deny private/metadata/host destinations on every new connection, CNAME/rebinding change, redirect target and reconnect. It has no Docker credentials, GUI channel or application secrets. Per-attempt authenticated identity and endpoint policy, finite traffic budgets and immediate revoke/close are required. An environment proxy variable configures a client but does not enforce this network boundary. Envoy's own dynamic-proxy documentation warns that untrusted clients/DNS can reach localhost/private/metadata services and requires firewall/default-deny restrictions. It is feasibility evidence, not selection or installation of Envoy. [Envoy dynamic forward proxy](https://www.envoyproxy.io/docs/envoy/latest/configuration/http/http_filters/dynamic_forward_proxy_filter)

| Option | What it can enforce | Limit / decision |
| --- | --- | --- |
| Provider-specific reverse gateway with fixed approved upstream and TLS terminated at gateway | Destination, method/path, request limits and provider credential injection outside attempt, where native client supports a custom base URL/protocol | Preferred for API-key recipes after pinned compatibility proof; needs reviewed per-provider protocol and secret ownership. Do not invent endpoints or claim OAuth/subscription parity. |
| Explicit CONNECT gateway with exact hostname:port allowlist and independent address firewall | Approved tunnel destination and byte/time bounds; native TLS remains end-to-end | Compatibility fallback only after review. Encrypted path, HTTP Host, tenant and API operation remain opaque; shared CDN IP/domain-fronting/tunnel reuse can defeat stronger origin claims. No arbitrary hostname suffix wildcard. |
| Per-attempt IP firewall allowlist without gateway | Network addresses/ports, including direct bypass denial when rules are complete | Not selected as sole provider policy: DNS churn/shared IPs and TLS obscure hostname/account; dynamic rule updates add race/rebinding burden. Useful as defense beneath a gateway. |

CONNECT becomes blind forwarding once established; it cannot by itself enforce encrypted URLs, block same-tunnel redirects, inject provider keys or prove account isolation. TLS interception requires client trust configuration and may fail with certificate pinning; never disable certificate verification or patch native clients to make a test pass. Therefore a pinned native CLI that needs unsupported network/auth behavior remains blocked, not silently given unrestricted egress. [RFC 9110 CONNECT](https://www.rfc-editor.org/rfc/rfc9110.html#section-9.3.6), [mitmproxy certificate/pinning constraints](https://docs.mitmproxy.org/stable/concepts/certificates/)

Pin and prove the host firewall backend. Docker's iptables backend provides DOCKER-USER; its nftables backend has no equivalent chain and requires separate tables/hooks with correct priority. Host INPUT and FORWARD paths both need coverage. Rule loss/restart fails readiness closed; rules are applied before networked start and remain until owned resources stop. Do not present an iptables recipe as a verified nftables policy. [Docker iptables](https://docs.docker.com/engine/network/firewall-iptables/), [Docker nftables](https://docs.docker.com/engine/network/firewall-nftables/)

## Future GUI broker channels

GUI containers are separate from harness containers, profiles, scratch and networks. Only a trusted broker can reach CDP, Cua Driver, X11, VNC/websockify or browser observations; raw addresses/sockets/tickets never enter LaunchSpec, model context or harness storage. RFC-006 host tools carry actor/run/attempt/invocation identity to that broker. The launcher routes only a fixed, bound tool channel and has no arbitrary TCP/socket forwarding API.

Later broker authorization additionally binds desktop/profile lease and control epoch. During human-secret takeover it denies both input and observations, drains/cancels in-flight work, discards queued frames, and rejects stale epochs after hand-back. The harness sandbox cannot read GUI process memory/files or bypass the pause through its provider gateway. The broker's separate viewer identity and authenticated route belong to RFC-074–078; this proposal adds neither a GUI launch recipe nor a viewer.

## Provisioning gates and next bounded work

| Required input | Current evidence / blocker |
| --- | --- |
| Dedicated Linux Docker host, kernel/cgroup/resource support and selected daemon endpoint | Probe design exists; production host policy and version-specific inspection still need proof. macOS host binaries are not Linux image contents. |
| linux-systemd-v1 unit/runner/cleanup helper and persistent private journal root on the Docker Linux host | Proposed here, not provisioned; existing macOS Docker/Colima access does not supply this control plane. Absent capabilities deny launch. Verify control crash, runner crash, daemon stall and host restart. No product hard-deadline claim before this proof. |
| Launcher TLS keypair, client identity, dedicated CA, custody/rotation and firewall | Must be provisioned separately; never reuse provider or Docker trust credentials. |
| Dedicated fixture-v1 image, immutable digest, source hash and architecture | Build from reviewed fixture source and explicit local base; base-image availability is not the final artifact. No dispatch-time downloads. |
| Six native Linux binaries/images, libraries and trusted host-tool extensions | Pin each version/digest, licensing and build provenance; verify Linux architecture/runtime dependencies, home/session/auth relocation, protocol and cancellation. Current host inventory alone is insufficient. |
| Native private state storage | Encryption-at-rest/custody, exclusive ownership/mounts and crash-safe checkpoint/restore still blocked. API-key envelope is not profile encryption. |
| Networked gateway/firewall and provider allowlists | New bounded provisioning/proof needed; DNS/redirect/TLS and proxy compatibility must be tested against actual pinned clients. No real provider/model call authorized by this ADR. |
| DB attempts/leases/grants and membership revoke integration | RFC-009/010 schema/service work must use accepted RFC-007 lock/issuance rules. |
| GUI image, broker and secure takeover | Separate RFC-074–078 work; never reuse harness sandbox for login. |

Next worker after design review should implement only strict LaunchSpec/recipe expansion and the ownership-journal transition core with injected Docker/control I/O, alongside focused negative cases: unknown field/path/env/image injection, stale fence, duplicate same/mismatched descriptor, expired deadline, create/start response loss, delayed receipt after cancellation, journal corruption and terminal tombstone replay. It must not start Docker, implement scheduling or add native credentials.

A subsequent explicitly scoped worker provisions the no-network fixture image and authenticated Linux launcher and runs real A/B containment, output/cancel/tree/cleanup and owner-crash scenarios. Then RFC-009/010 integrates the single DB dispatch authority; networked/native and GUI proofs remain separately bounded. No production supervisor is accepted by mocked lifecycle tests alone.

Design review acceptance: closed authenticated control; no caller filesystem/process authority; journal-before-effect and conservative unknown state; independent deadline owner; exact cleanup ownership; one DB queue/grant engine; explicit provider/TLS limitations; separate GUI broker; concrete provisioning gates. [Evidence and source inventory](../../.omo/evidence/runtime-008a/report.md) records what was actually inspected. Root task status remains coordinator-owned.
