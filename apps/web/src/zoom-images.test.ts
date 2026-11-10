import { Glob } from "bun";
import { expect, test } from "bun:test";

// A picture a person may want to inspect opens in the fullscreen viewer with zoom: it is `<ZoomImage>`, not a bare `<img>`.
// A bare `<img>` stays only where zoom does not fit (a decorative avatar, a picture inside a control that has its own action),
// and says why with `No zoom: <why>` in a comment within the 8 lines above it.
const OWN_FILE = "components/zoom-image.tsx";

test("every <img> is a ZoomImage or says why it is not", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.tsx").scan({ cwd: import.meta.dir })) {
    if (file === OWN_FILE || file.endsWith('.test.tsx')) continue;
    const lines = (await Bun.file(`${import.meta.dir}/${file}`).text()).split("\n");
    lines.forEach((line, i) => {
      if (!/<img\b/.test(line)) return;
      if (!lines.slice(Math.max(0, i - 8), i + 1).some((l) => l.includes("No zoom:")))
        offenders.push(`${file}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
