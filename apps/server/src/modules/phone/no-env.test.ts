// Phone numbers are configured in Studio (installation settings and the database), never through environment variables. This reads the
// source files of the module that are not tests and fails if one of them reaches for `process.env`.
import { expect, test } from "bun:test";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

test("no source file of the phone module reads process.env", () => {
  const files = readdirSync(import.meta.dir).filter(
    (f) => f.endsWith(".ts") && !f.endsWith(".test.ts"),
  );
  expect(files.length).toBeGreaterThan(5);
  const offenders = files.filter((f) =>
    /process\s*\.\s*env|import\.meta\.env/.test(readFileSync(join(import.meta.dir, f), "utf8")),
  );
  expect(offenders).toEqual([]);
});
