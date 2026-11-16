import { Glob } from "bun";
import { expect, test } from "bun:test";

// Every feature in the app is presented as working. A feature that is not proven gets a test, not a "Beta" or "Experimental" mark.
test("no screen renders a Beta or Experimental label", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.tsx").scan({ cwd: import.meta.dir })) {
    if (file.endsWith(".test.tsx")) continue;
    const text = await Bun.file(`${import.meta.dir}/${file}`).text();
    // JSX text or a string literal that is just the label.
    for (const m of text.matchAll(/>\s*(Beta|Experimental)\s*<|["'`](Beta|Experimental)["'`]/g))
      offenders.push(`${file}: ${m[0]}`);
    if (/\bBetaBadge\b|\bMaturityMark\b|\bEngineBadge\b/.test(text))
      offenders.push(`${file}: badge component`);
  }
  expect(offenders).toEqual([]);
});
