# Web app rules

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

An icon that carries meaning and has no visible title next to it must show its name in a tooltip. Use `<IconHint label="Chief"><CrownIcon /></IconHint>` from `@/components/icon-hint` (built on the `@g4rcez/components` Tooltip); it opens on hover, on keyboard focus and on tap. Put the name in `label` and remove `aria-label` from the icon: `IconHint` sets the accessible name once and hides the icon.

- Exception: a decorative icon next to visible text (`aria-hidden="true"`) needs no Popover.
- Never place `IconHint` inside a link or a button (nested interaction). There, keep the `aria-label`.
- An icon-only button, link or menu trigger (no visible text) is wrapped in `<ActionHint label="…">` from `@/components/action-hint` (the library Tooltip, merged onto the child with no wrapper element). The child keeps `aria-label` with the same text as `label` and has no native `title=`. When the label changes with state (keep awake on/off), pass the current text to both. Header and top-edge buttons use `side="bottom"`.
- `ActionHint` goes on a control that does an action; `IconHint` goes on an icon that does nothing.
- A control with an `aria-label` and visible text needs no hint. Put `No hint: <why>` in a comment right above it.
- `src/icon-buttons.test.ts` fails for a control with an `aria-label` that has neither an `ActionHint` around it nor that comment, and for a native `title=` on a control wrapped in `ActionHint`.

## No components inside components (`apps/web`)

A function that returns JSX is a component, always: PascalCase name, one props object, declared at the top level of its file. Never declare one inside another component, hook or function. `const row = (label) => <div>…</div>` inside a component, a lowercase `const icon = (I) => <I />` at the top of a file, and a hook that returns JSX are all this mistake: the nested function is new on every render, its props hide in a closure, and it can be neither memoized nor tested on its own.

- Extract it to a top-level component in the same file, right above its user, with typed props. Put `key` at the call site.
- A function stored in an object literal is a named component too. `{ Stack: (p) => <div /> }`, `{ draw: (f) => <path /> }` and `{ img: ({ alt }) => … }` are this mistake: write `function UiStack(…)` at the top level and store the reference (`{ Stack: UiStack }`). An entry may stay inline only when it hands off in one line: `Render: () => <ColorOption color={c} />`.
- Only anonymous callbacks may return JSX inline: `items.map((x) => <li key={x.id} />)` and render props. A named function (`function`, or `const x = () =>`) that returns JSX is a component.
- When you only want to bind many closure values onto one component, write a function that returns props (`sectionProps(b)`), not JSX, and spread it: `<BotSection key={b.id} {...sectionProps(b)} />`.
- A hook never returns JSX. Return the state and write a component that takes it (`useMention` + `<MentionPopup>`).
- An error boundary has to be a class (`features/memory/graph-boundary.tsx`); that is the one exception.
- The oxlint rule `zetta/components-top-level` (`tools/oxlint/zetta-plugin.ts`, loaded from `oxlint.config.ts`; `vite.config.ts` shares that config) fails `bun run check` and `vp lint` for a named function that returns JSX and is nested or not PascalCase, and for an object-literal entry that returns more than a one-line hand-off. It checks non-test `.tsx` files. `tools/oxlint/zetta-plugin.test.ts` runs the rule on fixtures and on the whole codebase: run `bun test tools` from the repo root (CI runs only the server tests).
