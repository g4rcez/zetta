# Project rules

## Links in the web app (`apps/web`)

Always use TanStack Router components for navigation; never a plain `<a href>` to a page inside the app, because it reloads the whole app.

- In-app page: `<Link to="/route/$param" params={{ param }} search={{ ... }}>` from `@tanstack/react-router`. Navigating from code: `useNavigate()` / `redirect()`.
- A path that only exists at runtime (for example a `resultLink` from the server): `<Link to={path as never}>` still routes without a reload.
- Plain `<a>` is only for leaving the app (`https://…`, `mailto:`), downloads, and links the bot writes in chat. Give external links `target="_blank" rel="noopener noreferrer"`.
- `src/in-app-links.test.ts` fails if a `.tsx` file has an `<a>` whose `href` starts with an in-app path.

## Public-repo hygiene

This repository is public. Never commit personal data, secrets, or machine-specific data.

- No absolute home paths (`/Users/<name>`, `/home/<name>`). Use relative paths, `homedir()`, or `${HOME}`.
- No real emails, phone numbers, tokens, or API keys. Test fixtures use obviously fake values (`@example.invalid`, `sk-test-…`, `5511900000000`).
- Never commit `.env` files. Only `.env.schema` (names, no values) is tracked.
- Never track agent run output (`.omo/`, `.trash/`, LSP dumps, transcripts); they hold local paths and tool receipts.
- Reference other projects by public URL (for example `https://github.com/g4rcez/testing-agent`), never by local path.
- Before a commit, run `git grep -nE '/Users/|/home/[a-z]+|@gmail\.com'` on the staged paths; the result must be empty.
