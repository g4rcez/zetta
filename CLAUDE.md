# Project rules

## Links in the web app (`apps/web`)

Always use TanStack Router components for navigation; never a plain `<a href>` to a page inside the app, because it reloads the whole app.

- In-app page: `<Link to="/route/$param" params={{ param }} search={{ ... }}>` from `@tanstack/react-router`. Navigating from code: `useNavigate()` / `redirect()`.
- A path that only exists at runtime (for example a `resultLink` from the server): `<Link to={path as never}>` still routes without a reload.
- Plain `<a>` is only for leaving the app (`https://…`, `mailto:`), downloads, and links the bot writes in chat. Give external links `target="_blank" rel="noopener noreferrer"`.
- `src/in-app-links.test.ts` fails if a `.tsx` file has an `<a>` whose `href` starts with an in-app path.

## Free text in the web app (`apps/web`)

Every free-text input is the chat's text box, so `@bot` and `#team`/`#room` mentions work the same way across the whole system. Never build a second text box for free text. Take the text box only: the full `Composer` (toolbar, attachments, `/` picker) belongs to chat screens.

- Every multi-line text box is the CodeMirror `Editor` from `components/editor/editor.tsx` (our own integration, no React wrapper). It edits Markdown and highlights a fenced block in its language. It is not a `<textarea>`: read and write the text through `value`/`onChange`, or `view.state` and `view.dispatch` (`viewRef`). In a `<form>`, `name`, `required` and `defaultValue` work as on a textarea.
- A text box with its own layout (a question, a reply, an inline field): `<MentionField>` from `features/chat/mention.tsx`. It is a bare `Editor` with the chat's picker; add your own button and Enter handling (`onKeyDown` gets the native event: call `e.preventDefault()` to take the key). Example: `features/memory/ask-box.tsx`.
- A labeled field inside a form (description, prompt, note, goal): `<MentionTextarea>` from the same file. It works controlled (`value`, `onChange`) or in a `<form>` (`name`, `defaultValue`).
- No bare `<textarea>`, `<Textarea>` or `<input>` for natural-language text. Short structured fields (name, title, email, number, date, search filter) may stay `Input`.
- Keep a plain `<EditorField>` (or `<Editor>`) without the picker where a picker would get in the way: patterns and config (tool allow lists, plugin values), pasted external content, files for other tools (SKILL.md, agent files), templates shared with other users (output styles) and Markdown with its own link picker (memory content). Put `Plain on purpose: <why>` in a comment right above it.
- All CodeMirror styles live in `components/editor/codemirror.css`, nowhere else. Keep them to small layout fixes and the `tok-*` colors.
- `src/free-text.test.ts` fails for any `<Textarea>` or `<textarea>` outside the editor, and for a bare `<Editor>` or `<EditorField>` without that comment. `src/features/chat/mention-typing.test.ts` types `@` and picks a bot in both components.

## Filters live in the URL (`apps/web`)

Every filter of a page lives in the address, because the URL is the real state: a reload, Back/Forward and a shared link must show the same view. Never keep a filter only in component state.

- A filter is anything that changes what a page lists or shows: search text, tab, category, status, sort, scope (mine / all), date range, the chosen repository or page.
- Put it in the route's search params with `validateSearch` and a pure parser, as in `features/memory/memory-filters.ts` and `features/skills/skills-search.ts`. Use string enums (not booleans), leave defaults out of the address, and drop what is not understood.
- The page component does not read the router: the route passes `search` and `setSearch` as props. Typing in a filter navigates with `replace: true`; choosing a tab or submitting a search adds a history entry.
- The input shows the value from the URL, or a draft that is written to the URL on submit. Results load from the URL (an effect on the search param), never from a click handler, so Back and a pasted link work.
- These stay local: ticked rows, an expanded row, open menus and dialogs, and a filter inside a transient card that is not a page view (the chat's "Install skills?" card).
- Test it by mounting the page with a search value and no clicks (see `features/skills/skills-page.test.tsx`).
- Not moved yet, so do it when you touch them: the filters in `features/studio/plugins.tsx`, `features/discussions/discussions-page.tsx` and the sidebar search.

## Icons without a visible title (`apps/web`)

An icon that carries meaning and has no visible title next to it must show its name in a Popover. Use `<IconHint label="Chief"><CrownIcon /></IconHint>` from `@zetta/ui/components/icon-hint`; it opens on hover, on keyboard focus and on tap. Put the name in `label` and remove `aria-label` from the icon: `IconHint` sets the accessible name once and hides the icon.

- Exception: a decorative icon next to visible text (`aria-hidden="true"`) needs no Popover.
- Never place `IconHint` inside a link or a button (nested interaction). There, keep the `aria-label`.
- Open point: an icon-only button that acts on click keeps `Tooltip` + `aria-label` until the owner decides.

## Public-repo hygiene

This repository is public. Never commit personal data, secrets, or machine-specific data.

- No absolute home paths (`/Users/<name>`, `/home/<name>`). Use relative paths, `homedir()`, or `${HOME}`.
- No real emails, phone numbers, tokens, or API keys. Test fixtures use obviously fake values (`@example.invalid`, `sk-test-…`, `5511900000000`).
- Never commit `.env` files. Only `.env.schema` (names, no values) is tracked.
- Never track agent run output (`.omo/`, `.trash/`, LSP dumps, transcripts); they hold local paths and tool receipts.
- Reference other projects by public URL (for example `https://github.com/g4rcez/testing-agent`), never by local path.
- Before a commit, run `git grep -nE '/Users/|/home/[a-z]+|@gmail\.com'` on the staged paths; the result must be empty.
