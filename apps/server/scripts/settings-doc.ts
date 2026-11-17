/**
 * Writes docs/operations/settings.md from apps/server/.env.schema. `--check` writes nothing and exits 1 when the page is out of date.
 *   bun run settings:doc            (in apps/server)
 *   bun run settings:doc -- --check
 */
import { readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";

import { parseEnvSchema, renderSettingsDoc } from "../src/env-schema";

const root = join(import.meta.dir, "..", "..", "..");
const schema = join(root, "apps", "server", ".env.schema");
const page = join(root, "docs", "operations", "settings.md");

const next = renderSettingsDoc(parseEnvSchema(readFileSync(schema, "utf8")));
if (process.argv.includes("--check")) {
  let current = "";
  try {
    current = readFileSync(page, "utf8");
  } catch {}
  if (current !== next) {
    console.error(
      "docs/operations/settings.md is out of date: run `bun run settings:doc` in apps/server.",
    );
    process.exit(1);
  }
  console.log("docs/operations/settings.md is up to date.");
} else {
  writeFileSync(page, next);
  console.log(`Wrote ${page.replace(root + "/", "")}`);
}
