# RFC-074a independent technical review

Date: 2026-10-22. Scope: proposed research recommendation, not operational acceptance.

- codeQualityStatus: CLEAR
- recommendation: APPROVE
- blockers: [] for accepting this research proposal
- RFC-074 and production browser/computer capability remain operationally incomplete.

## Findings by severity

- CRITICAL: none.
- HIGH: none.
- MEDIUM: none.
- LOW: none.

The proposal is supported by the inspected pinned public-source receipts and preserves the accepted ownership/isolation/secrets boundaries. No unsupported claim requires correction before research acceptance. The provisioning and integration gates listed below remain requirements, not waived findings.

## Evidence inspected

Read `docs/decisions/browser-computer.md`, `tasks/074a-research-isolated-browser-computer-backends.md`, the ownership, execution-isolation, connection-secrets and harness-compatibility ADR context, and the active attempt's `browser-computer/{sources.json,viewer-sources.json,review.md,check.ts,check.json}`. Parsed the 36 captured source entries and inspected the relevant manifests, licensing declarations, Linux registry/clipboard source, protocol documentation, browser streaming/security guidance and viewer interfaces directly. Public-source receipts were sufficient for the reviewed claims; no additional web fetch or runtime execution was needed.

Independent SHA256 readback matches the integrity receipt:

```text
3e3559f56f1366d39507052d7d23ab0cc582d039a871fdb66d412c7fab8a6718  docs/decisions/browser-computer.md
db13907904c8af4958ebca9eeca39b4d8d4a850f1d97fce0595e6005892a1db2  tasks/074a-research-isolated-browser-computer-backends.md
eadaafc26b5e8e7c53a3c95a9015a0b514930885169ef0f21ba8f509026674c2  browser-computer/sources.json
e46ee7f0b12c5cd9f6d164b49873428a59e9076539523ed90577e02ce33aad27  browser-computer/viewer-sources.json
```

The receipt root is `local evidence`. A separate read-only Bun check independently resolved all seven local Markdown links with zero missing targets and counted 36 source entries. The author's `check.ts` was read rather than executed because it writes its existing receipt; these checks establish document integrity only.

## Technical assessment

**License distinctions are supported.** At CUA commit `688c5fd62a9f13dddc309970c948df494e7de33f`, the driver manifest declares 0.38.0/MIT, and its README explicitly distinguishes the optional AGPL-3.0-only perception detector. `legal/LICENSING.md` lists spacesd/relay, media, viewer and related Spaces components under FSL-1.1-MIT. The ADR correctly excludes those from the selected standalone driver path. This is verification of upstream declarations, not a legal distribution approval. The noVNC core MPL-2.0 and separate asset notices, TigerVNC GPL text/component notices and websockify LGPLv3 declaration are also represented accurately.

**Linux desktop support is independent of Spaces.** The driver's `desktop.rs` registers desktop/window/input/clipboard tools for Linux, macOS and Windows. `platform-linux/src/clipboard.rs` implements the clipboard backend through `clipboard_rs`, including native X11 text-roundtrip test source; it does not invoke spacesd. Linux guidance/action-support documents X11/Openbox, AT-SPI and foreground XTest routes and explicit background refusals. Upstream CI statements are not Zetta execution evidence. The ADR avoids presenting Xvfb evidence as proof of Xvnc, real Xorg/uinput, Wayland or arbitrary toolkits.

**Protocol claims are appropriately pinned.** The examined driver documentation distinguishes legacy MCP initialization at `2025-06-18` from per-request metadata/discovery at `2026-07-28`; the HTTP endpoint remains legacy. Agent-browser commit `468c0526c884722afd9c10bcc0d5b09ed4c0c5d1` declares 0.39.1; its stream documentation describes automatic local WebSockets, JPEG/base64 frames and mouse/keyboard/touch input. Its origin rules are not actor authorization. The ADR correctly declines to treat the old BrowserManager example as an exported native-package SDK. Domain-allowlist incompatibility with persistent profiles/CDP/restore is explicit, so network containment remains below the browser.

**The desktop viewer pairing is plausible but unverified.** TigerVNC's source describes Xvnc as both an X server and VNC server; noVNC consumes RFB over WebSocket; websockify bridges binary RFC6455 WebSocket traffic to TCP. This supports the proposed interface composition only. The ADR explicitly requires a release/build/image digest and negotiated runtime proof; TigerVNC 1.16.80 is correctly labeled development source. Xvnc's server-side key/pointer and clipboard direction controls support the future policy; noVNC `viewOnly` cannot enforce it. Spaces media wire v2, port/path differences and reusable ticket/disconnect semantics are accurately treated as a separate unselected stack.

**Credential pause has a real containment boundary in the proposal.** `docs/decisions/browser-computer.md:9` separates arbitrary-code harness sandboxes from GUI sandboxes. Only the trusted broker can reach browser/CDP/driver/X11/VNC channels; only the launcher has Docker authority. This prevents the obvious proposed-design bypass where an agent skips a paused host-tool gate and reads the GUI directly. Lines 55-58 require quiescence before human input, suppression of observations and queued results, owner-only viewing, explicit hand-back with a new epoch, revocation/connection closure and crash reconciliation. These are requirements to implement and attack-test, not a claim that the current code enforces them. The secret ADR's unsupported native-profile backend is preserved.

**All six image paths remain blocked.** Lines 64-73 preserve six separate native bridges and identify the RFC-006 JSON-string limitation. No row claims operational image delivery, no public image URL is substituted for owner-scoped multimodal transport, and Cursor remains unlocated/unverified. Jev/Laya and browser automation do not replace a required harness or full desktop capability.

## Next bounded provisioning prerequisites

1. Produce the exact reproducible image/dependency manifest and release digests, including working Chromium sandbox, X11/WM/D-Bus/AT-SPI, driver, Xvnc, noVNC and websockify. Resolve component notices/distribution choices before shipping; no upstream auto-install helper or host-profile reuse.
2. Define launcher/broker ownership for separate code and GUI sandboxes, exclusive profile/desktop leases, fixed private channel targets, finite resource budgets and receipt-based teardown. Keep the first disposable app/clipboard/desktop proof synthetic and isolated; public browsing requires the separate actual egress proof.
3. Exercise the exact Xvnc pairing with an independent editor-state/file oracle and actor B controls before treating it as a supported desktop backend. Verify both VNC clipboard directions and absence of host display/session/Docker sockets.
4. Before real login/persistence, accept and prove native-profile encrypted storage/restore and the takeover observation/input barrier, including pending work, reconnect, stale epochs, revocation and uncertain cleanup. Before model-facing use, evolve the typed image contract as needed and prove all six native/model round trips independently.

These are bounded follow-up assignments. Full six-harness acceptance is not required merely to perform an independently authorized synthetic Xvnc pairing proof, but remains required for product delivery. Research acceptance does not authorize installations, services or account access by itself.

## Skill perspective and verification boundary

Applied the already-loaded code-review-and-quality, programming/TypeScript and remove-ai-slops perspectives. No production code or behavioral tests are changed in this research slice. Documentation integrity pins are explicitly labeled as integrity checks and are not substituted for execution evidence; no brittle prose regression test or unnecessary production parser was introduced. No skill-perspective violation in the reviewed recommendation requires a finding.

No product code, service, container, installation, Git state, account, model or provider was touched. No browser/desktop feature is claimed working. Only this review and its uniquely named current-attempt copy were written.
