import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

// Every place that decides where state lives goes through dataDir (@zetta/core/zetta-home), so an installation with ZETTA_HOME set keeps
// nothing outside that folder. A new default written against the home folder or the working directory would leak out of it.
const root = join(import.meta.dir);
const files = (dir: string): string[] =>
  readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return files(path);
    return name.endsWith(".ts") && !/\.test\.ts$|integration/.test(name) ? [path] : [];
  });

const forbidden = [
  /join\(homedir\(\), "\.zetta"/,
  /join\(homedir\(\), "\.cache"/,
  /\$\{process\.cwd\(\)\}\/\.zetta-/,
];

describe("data paths", () => {
  test("no default state path bypasses dataDir", () => {
    const hits: string[] = [];
    for (const file of files(root)) {
      const text = readFileSync(file, "utf8");
      // The one legacy default that dataDir itself receives is passed as its second argument.
      for (const line of text.split("\n"))
        if (forbidden.some((re) => re.test(line)) && !/dataDir\(/.test(line))
          hits.push(`${file.slice(root.length + 1)}: ${line.trim()}`);
    }
    expect(hits).toEqual([]);
  });
});
