# Project rules

Web app rules (links, free text, filters in the URL, icons without a title) live in `apps/web/CLAUDE.md` and load when you work under `apps/web`.

## Public-repo hygiene

This repository is public. Never commit personal data, secrets, or machine-specific data.

- No absolute home paths (`/Users/<name>`, `/home/<name>`). Use relative paths, `homedir()`, or `${HOME}`.
- No real emails, phone numbers, tokens, or API keys. Test fixtures use obviously fake values (`@example.invalid`, `sk-test-…`, `5511900000000`).
- Never commit `.env` files. Only `.env.schema` (names, no values) is tracked.
- Never track agent run output (`.omo/`, `.trash/`, LSP dumps, transcripts); they hold local paths and tool receipts.
- Reference other projects by public URL (for example `https://github.com/g4rcez/testing-agent`), never by local path.
- Before a commit, run `git grep -nE '/Users/|/home/[a-z]+|@gmail\.com'` on the staged paths; the result must be empty.

## Tooling in TypeScript

Configuration and custom lint rules are TypeScript, never JSON or plain JS.

- Linter: `oxlint.config.ts`. Formatter: `oxfmt.config.ts`. Both use `defineConfig` from their package, and `vite.config.ts` imports them so `vp lint` and `vp fmt` read the same settings. Do not add `.oxlintrc.json` or `.oxfmtrc.json`.
- Custom lint rules live in `tools/oxlint/*.ts`, registered through `jsPlugins` in `oxlint.config.ts`. Keep them to erasable syntax (no enums, namespaces or imports) so Node 22.18+ loads them without a build step; oxlint reads TypeScript configs on Node only.
- New tool that accepts a `.ts` config (the tool's own file, or `vite.config.ts`): use it.
