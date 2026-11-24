import { describe, expect, test } from "bun:test";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { hasPluginIcon } from "./plugin-icon";

/** Every `.ts` file (not a test) below a folder. */
function sources(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) return sources(path);
    return name.endsWith(".ts") && !name.includes(".test.") ? [path] : [];
  });
}

describe("plugin icons", () => {
  // The rule: every plugin shows an icon that says what it is. An icon key that the map does not know falls back to the generic plug.
  test("every plugin definition names an icon the web app has", () => {
    const root = new URL("../../../../server/src/modules", import.meta.url).pathname;
    const missing: string[] = [];
    let seen = 0;
    for (const file of sources(root)) {
      const text = readFileSync(file, "utf8");
      if (!text.includes("registerPlugin(")) continue;
      const id = /^\s*id: "([^"]+)"/m.exec(text)?.[1];
      for (const m of text.matchAll(/^\s*icon: "([^"]+)"/gm)) {
        seen++;
        if (!hasPluginIcon(m[1]!, id)) missing.push(`${file.slice(root.length + 1)}: ${m[1]}`);
      }
    }
    expect(seen).toBeGreaterThan(15);
    expect(missing).toEqual([]);
  });
});
