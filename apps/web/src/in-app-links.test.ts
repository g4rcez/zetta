import { Glob } from "bun";
import { expect, test } from "bun:test";

// An in-app path in a plain <a href> makes the browser reload the whole app; those links must be TanStack <Link>.
test("no plain anchor points at an in-app path", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.tsx").scan({ cwd: import.meta.dir })) {
    const text = await Bun.file(`${import.meta.dir}/${file}`).text();
    for (const m of text.matchAll(/<a\b[^>]*?\bhref=(?:"\/(?!\/)|\{`\/)/gs))
      offenders.push(`${file}: ${m[0].slice(0, 60)}`);
  }
  expect(offenders).toEqual([]);
});
