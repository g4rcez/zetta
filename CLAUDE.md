# Project rules

## Links in the web app (`apps/web`)

Always use TanStack Router components for navigation; never a plain `<a href>` to a page inside the app, because it reloads the whole app.

- In-app page: `<Link to="/route/$param" params={{ param }} search={{ ... }}>` from `@tanstack/react-router`. Navigating from code: `useNavigate()` / `redirect()`.
- A path that only exists at runtime (for example a `resultLink` from the server): `<Link to={path as never}>` still routes without a reload.
- Plain `<a>` is only for leaving the app (`https://…`, `mailto:`), downloads, and links the bot writes in chat. Give external links `target="_blank" rel="noopener noreferrer"`.
- `src/in-app-links.test.ts` fails if a `.tsx` file has an `<a>` whose `href` starts with an in-app path.

## Free text in the web app (`apps/web`)

Every free-text input is the chat's text box, so `@bot` and `#team`/`#room` mentions work the same way across the whole system. Never build a second text box for free text. Take the text box only: the full `Composer` (toolbar, attachments, `/` picker) belongs to chat screens.

- A text box with its own layout (a question, a reply, an inline field): `<MentionField>` from `features/chat/mention.tsx`. It is a bare `<textarea>` with the chat's picker; add your own button and Enter handling. Example: `features/wiki/ask-box.tsx`.
- A labeled field inside a form (description, prompt, note, goal): `<MentionTextarea>` from the same file. It works controlled (`value`, `onChange`) or in a `<form>` (`name`, `defaultValue`).
- No bare `<textarea>`, `<Textarea>` or `<input>` for natural-language text. Short structured fields (name, title, email, number, date, search filter) may stay `Input`.
- Keep a plain `Textarea` where a picker would get in the way: patterns and config (tool allow lists, plugin values), pasted external content, files for other tools (SKILL.md, agent files), templates shared with other users (output styles) and Markdown with its own link picker (wiki content). Put `Plain on purpose: <why>` in a comment right above it.
- `src/free-text.test.ts` fails for a plain `<Textarea>` or `<textarea>` without that comment. `src/features/chat/mention-typing.test.ts` types `@` and picks a bot in both components.

## Public-repo hygiene

This repository is public. Never commit personal data, secrets, or machine-specific data.

- No absolute home paths (`/Users/<name>`, `/home/<name>`). Use relative paths, `homedir()`, or `${HOME}`.
- No real emails, phone numbers, tokens, or API keys. Test fixtures use obviously fake values (`@example.invalid`, `sk-test-…`, `5511900000000`).
- Never commit `.env` files. Only `.env.schema` (names, no values) is tracked.
- Never track agent run output (`.omo/`, `.trash/`, LSP dumps, transcripts); they hold local paths and tool receipts.
- Reference other projects by public URL (for example `https://github.com/g4rcez/testing-agent`), never by local path.
- Before a commit, run `git grep -nE '/Users/|/home/[a-z]+|@gmail\.com'` on the staged paths; the result must be empty.
