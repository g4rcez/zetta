import { defineConfig } from "oxlint";

// Standalone `oxlint` and `vp lint` (through vite.config.ts) read this one file. Oxlint reads TypeScript configs on Node only.
export default defineConfig({
  plugins: ["typescript", "unicorn", "oxc"],
  // The project's own rules, written in TypeScript (apps/web/CLAUDE.md "No components inside components").
  jsPlugins: ["./tools/oxlint/zetta-plugin.ts"],
  categories: { correctness: "error" },
  rules: { "zetta/components-top-level": "error" },
  env: { builtin: true },
  ignorePatterns: [
    "node_modules/**",
    "**/node_modules/**",
    "apps/web/dist/**",
    "apps/web/.tanstack/**",
    "apps/web/src/routeTree.gen.ts",
    "apps/server/dist/**",
    "packages/db/dist/**",
    ".alchemy/**",
  ],
});
