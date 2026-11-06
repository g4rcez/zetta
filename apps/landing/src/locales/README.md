# Locales

All the words of the landing page, one JSON file per language:

- `en.json` is the source of truth. Its shape is the type of every other language.
- `pt-br.json` must have the same keys. A missing key fails `bun run build` (type check), so a language never ships half translated.

To change a text, edit the value in the JSON. To add a language, copy `en.json`, translate it and register it in `src/i18n/index.ts` and `src/pages`.

## Rules for the copy

- Every claim matches code that exists in the repository. No testimonials, pricing or metrics: PRODUCT.md forbids inventing them.
- The clips in `public/videos` and the screenshots in `public/screens` are real captures of the app in light mode, taken on a throwaway install with demo data.
- The bots and the cloud in the hero graph, the chief's org chart and its proposal are illustrations. Say so in their `alt` text.
- A heading with an emphasized phrase is `{ "before", "mark", "after" }`: the `mark` is set bolder and in the main color.
