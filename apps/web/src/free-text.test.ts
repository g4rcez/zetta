import { Glob } from "bun";
import { expect, test } from "bun:test";

// CLAUDE.md "Free text in the web app": free text is typed in the chat's text box (`MentionField` or `MentionTextarea`), so `@` and `#`
// mentions work everywhere. A plain textarea is allowed only with a `Plain on purpose: <why>` comment right above it.
// `chat/mention.tsx` and `chat/composer.tsx` are where the chat's own text boxes are built.
const OWNERS = ["features/chat/mention.tsx", "features/chat/composer.tsx"];

test("every plain textarea says why it is not the chat's text box", async () => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.tsx").scan({ cwd: import.meta.dir })) {
    if (OWNERS.includes(file)) continue;
    const lines = (await Bun.file(`${import.meta.dir}/${file}`).text()).split("\n");
    lines.forEach((line, i) => {
      if (!/<(Textarea|textarea)\b/.test(line)) return;
      const above = lines.slice(Math.max(0, i - 2), i).join("\n");
      if (!above.includes("Plain on purpose:")) offenders.push(`${file}:${i + 1}`);
    });
  }
  expect(offenders).toEqual([]);
});
