# RFC-012a: Record versioned harness protocol inputs

- **Parent:** [RFC-012](012-research-six-harness-compatibility.md), whose root-index row remains authoritative and incomplete.
- **Module:** Harness adapters
- **Status:** Review; protocol discovery recorded with explicit blockers.
- **Type:** Bounded research handoff
- **Dependencies:** Parent research context; implementation still requires accepted [RFC-002](002-prove-multi-user-execution-isolation.md) and [RFC-006](006-define-harness-contract-and-fixture-adapter.md).

## Context and authority

User's continued v1 authorization and coordinator assignment permit read-only local/public protocol discovery before the runtime prerequisites finish. The assignment owns only this child and [harness-compatibility.md](../docs/decisions/harness-compatibility.md). No adapters, installs, accounts, secret reads, real model calls, staging or commits are authorized. Read execution rules, plan, confirmed intent, parent 012, RFC-006, execution-isolation decision and the v1 notepad before research.

## Goal and non-goals

Give the next worker versioned commands, event/terminal behavior, host-tool bridge candidates, native state/auth/model paths, cancellation/deadline strategy and explicit missing-source blockers for Pi, Codex, OMP, Claude Code, OpenCode and Cursor. This is evidence input, not an accepted universal contract or production compatibility result.

## Exported contract

The decision artifact separates observed probes, source-supported transport proposals and unverified operational behavior. Pi uses its version-matched RPC/extension contract; Codex has an installed generated app-server/dynamic-tool contract; OMP has versioned RPC/native host callbacks; Claude has headless/MCP flags with a version-matching gap; OpenCode has the actual v2 HTTP/SSE/MCP contract; Cursor lacks a verified installed/pinned target and remains blocked. All six remain required. Local Zetta tool bridging is explicitly separate from RFC-043 external app MCP sessions.

## Acceptance criteria

- [x] Six required product/version rows, primary source URLs, access date and unknowns recorded.
- [x] Commands, events, private native-state strategy, host bridge, resume/catalog and cancellation candidates recorded without performing account/model discovery.
- [x] Real conformance checklist and provider egress gates distinguish fixtures/research from compatibility proof.
- [ ] Parent prerequisite handoffs and owner acceptance of every required operational strategy. This is parent/adapter work, not satisfied by this child.

## Verification

Check new Markdown relative links and required sections once after writing. No application tests/build/E2E or provider calls are needed for a documentation-only research artifact. Any later runtime fixture or smoke test needs its owning RFC's accepted scope and isolated synthetic setup.

## Completion record

- **Status:** Review. Bounded discovery finished; parent RFC-012 remains incomplete. No dependent adapter implementation is unblocked by this artifact alone.
- **Approval references:** User's v1/read-only discovery authorization and coordinator's 012a assignment. Coordinator reviewed the matrix and accepted candidate transports for implementation planning on 2026-10-22, explicitly retaining native operational proof. RFC-002 decision is only partially proved; RFC-006 has no accepted exported implementation contract.
- **Changed paths:** `docs/decisions/harness-compatibility.md`, `tasks/012a-record-harness-protocols.md` only. Existing dirty work preserved; no root-index/parent-status mutation by this worker.
- **Evidence:** All local help/version commands in the artifact exited 0. Installed Codex 0.163.0 generated experimental app-server types successfully under task temp. Public tag source resolved OMP18.6.1 versus global-package17.4.2 mismatch and supplied OpenCode2.0.28 v2 routes. All external references accessed 2026-10-22. No fabricated commit SHA or unobserved provider result.
- **Focused documentation check:** Bun relative-link/section assertion exited 0: two files, six existing relative links, eight required matrix sections. Runtime tests deliberately not run. Exact command follows.
- **Failure/privacy behavior:** Private actor+harness homes and exclusive session leases; no host daemon/keyring fallback; supervisor-owned deadlines/cancellation; native callback IDs cannot choose actors; no blind uncertain-action retries. OpenCode credential listing returns secrets and is excluded from readiness/discovery. No credentials, account payloads or model content captured.
- **Remaining blockers:** Incomplete runtime prerequisites; unapproved/untested local bridge transport; no real six-harness text/tool/error/cancel/resume/login proof; untested egress. Claude2.1.233 wire/control matching and OAuth relocation remain unverified. Cursor product binary/version, full native state relocation and callback path remain blocked.
- **Next consumer:** RFC-006 may use this research to define capability absence and terminal fixtures; it must not present source-supported mechanisms as observed integrations. Coordinator reviews transport candidates and identifies a pinned isolated Cursor target; parent 012/adapter workers own any approved follow-up proof.

```sh
bun -e 'import { existsSync } from "node:fs"; import { dirname, resolve } from "node:path"; const files = ["docs/decisions/harness-compatibility.md", "tasks/012a-record-harness-protocols.md"]; let links = 0; for (const file of files) { const text = await Bun.file(file).text(); for (const match of text.matchAll(/\]\(([^)]+)\)/g)) { const target = match[1]; if (/^https?:/.test(target)) continue; const path = target.split("#")[0]; if (!existsSync(resolve(dirname(file), path))) throw new Error(`${file}: missing ${target}`); links += 1; } } const matrix = await Bun.file(files[0]).text(); for (const name of ["Pi 1.4.0", "Codex 0.163.0", "OMP 18.6.1", "Claude Code 2.1.233", "OpenCode 2.0.28", "Cursor: blocked target", "Probe receipt", "conformance gates"]) if (!matrix.includes(name)) throw new Error(`Missing section: ${name}`); console.log(JSON.stringify({ files: files.length, relativeLinks: links, requiredSections: 8, passed: true }));'
```
