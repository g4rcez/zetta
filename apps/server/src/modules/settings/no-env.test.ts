// Settings live in the database. The module that stores them reads no environment itself: the import for upgraders is handed the
// environment by services.ts. This reads the source files of the module that are not tests and fails if one reaches for `process.env`.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("no source file of the settings module reads process.env", () => {
  const files = readdirSync(import.meta.dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  expect(files.length).toBeGreaterThanOrEqual(4);
  const offenders = files.filter((f) =>
    /process\s*\.\s*env|Bun\s*\.\s*env|import\.meta\.env/.test(
      readFileSync(join(import.meta.dir, f), "utf8"),
    ),
  );
  expect(offenders).toEqual([]);
});
