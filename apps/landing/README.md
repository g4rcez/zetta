# Zetta landing page

Static Astro site in English (`/`) and pt-BR (`/pt-br/`).

- `bun run dev` starts the dev server. `bun run build` writes `dist/`.
- All copy is in `src/i18n/en.ts` (source of truth) and `src/i18n/pt-br.ts` (must match its shape).
- Color tokens in `src/styles/global.css` are copied from `packages/ui/src/styles/globals.css`. Change the source first.
