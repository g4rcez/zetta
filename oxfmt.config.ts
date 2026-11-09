import { defineConfig } from "oxfmt";

// Standalone `oxfmt` and `vp fmt` (through vite.config.ts) read this one file.
export default defineConfig({
  singleQuote: false,
  semi: true,
  sortPackageJson: true,
  ignorePatterns: [
    "node_modules/**",
    "**/node_modules/**",
    "apps/web/dist/**",
    "apps/web/.tanstack/**",
    "apps/web/src/routeTree.gen.ts",
    "apps/server/dist/**",
    "packages/db/dist/**",
    ".alchemy/**",
    // The proof migrations are frozen: their hashes pin the exact bytes.
    "packages/db/*-test-migrations/**",
  ],
});
