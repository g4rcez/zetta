# Application integrations decision (RFC-042)

Status: accepted for v1 (implementation: `apps/server/src/modules/integrations`, `connections`). Owner approval for external providers is recorded below as **per-user opt-in**, not as an installation-wide grant.

## Decision

1. **MCP is the only generic tool-integration path.** Official TypeScript SDK `@modelcontextprotocol/sdk` 1.32.1 (MIT). Two transports:
   - **Streamable HTTP**: public HTTPS addresses only (same SSRF policy as browser use: no localhost, private, link-local or `.local/.internal` targets, DNS-resolved check). Optional bearer token from the owner's sealed connection (`connectionId`), resolved at call time.
   - **stdio**: only commands the installation administrator listed in `ZETTA_MCP_ALLOWLIST` (exact path match). Minimal environment (`PATH`, `HOME`), no secrets inherited. This is the *local-process containment* rule: a user can never make the server run an arbitrary command.
2. **Per-user binding.** MCP servers belong to one user (`mcp_server`). A bot may use a server only through that same user's `bot_integration` row. Sharing a bot never shares servers, connections, chats or memory; another user must add and bind their own server.
3. **Sessions are short-lived.** A standalone call opens a session, applies a 20 s deadline and always closes it; within one chat turn a *scope* keeps a server's session open across the bot's tool calls (stateful servers like a browser need that) and closes it when the turn ends (tests count open/close). Stdio servers run in a neutral temporary working directory. Results are text-only and capped at 8 KB.
4. **Secrets.** Never stored in `mcp_server`; injected as an `Authorization` header from the sealed store. Revoked/missing connection means the call is not made and no other credential is tried.
5. **Revocation.** Removing a server deletes its bindings; revoking the connection fails calls closed.

## Source coverage for v1 acceptance

| Source | Path | Status |
| --- | --- | --- |
| Blogs / public pages | `source` kind `web`, read through the user's isolated browser profile; or `/browse` in chat | Implemented, browser tested; live public-site run done manually |
| RSS/Atom (blogs, Reddit `.rss`, many newsletters' public feeds) | `source` kind `rss`, SSRF-guarded fetch, no redirects, bounded | Implemented, fake-feed tests |
| Email newsletters (private inbox) | Needs the user's mailbox access (IMAP/OAuth or an MCP mail server) | **BLOCKED-EXTERNAL**: needs a user-approved mailbox and OAuth scopes; use a mail MCP server bound by the user, or forward newsletters to a public RSS bridge |
| X timelines | X's API is paid and login-walled; the browser path needs a signed-in profile and human takeover for login | **BLOCKED-EXTERNAL** for unattended runs; interactive takeover works |
| Reddit | Public `.rss` feeds work today via RSS source; authenticated access not provided | Partial (public only) |
| Chrome DevTools (browser debugging/automation) | MCP stdio server `chrome-devtools-mcp` bound by the user | **Verified live**: real server and real headless Chrome driven through Zetta's MCP layer (list tools, `new_page`, `take_snapshot`) in `chrome-devtools.integration.test.ts` (`ZETTA_MCP_CHROME_TEST=1`; allowlist the `npx` path) |
| Repository research | MCP server for the host (e.g. GitHub MCP) bound by the user | Supported by design; no server is bundled; not exercised live |

Manual import does **not** satisfy the browser/computer requirement; browser sessions with takeover are implemented separately (RFC-074–078).

## Explicit non-goals
No marketplace, no bespoke connector per README app, no OAuth scope grant by implication, no unapproved network egress from stdio servers (administrator's responsibility: run allowlisted commands in an environment with the egress policy they need).

## Known limits
- Allowlisted stdio commands run as the server's OS user (not in a container). Allowlist only commands you trust.
- DNS rebinding between the address check and the connection is not closed for HTTP servers.
