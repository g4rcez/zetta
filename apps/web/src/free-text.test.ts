import { Glob } from "bun";
import { expect, test } from "bun:test";

// CLAUDE.md "Free text in the web app": every multi-line box is the CodeMirror `Editor`. Free text is typed in the chat's text box
// (`MentionField` or `MentionTextarea`), so `@` and `#` mentions work everywhere. A bare `Editor` or `EditorField` is allowed only
// with a `Plain on purpose: <why>` comment right above it. Nobody builds a `<textarea>`, except the editor for the form value it carries.
const EDITOR = "components/editor/editor.tsx";
// Where the chat's own text boxes are built from the editor.
const OWNERS = [EDITOR, "features/chat/mention.tsx", "features/chat/composer.tsx"];

// Other components are also called `Editor` (the flow canvases): only files that import ours count.
const scan = async (pattern: RegExp, skip: string[], needsReason: boolean, imports = "") => {
  const offenders: string[] = [];
  for await (const file of new Glob("**/*.tsx").scan({ cwd: import.meta.dir })) {
    if (skip.includes(file)) continue;
    const text = await Bun.file(`${import.meta.dir}/${file}`).text();
    if (!text.includes(imports)) continue;
    const lines = text.split("\n");
    lines.forEach((line, i) => {
      if (!pattern.test(line)) return;
      const above = lines.slice(Math.max(0, i - 2), i).join("\n");
      if (!needsReason || !above.includes("Plain on purpose:")) offenders.push(`${file}:${i + 1}`);
    });
  }
  return offenders;
};

test("nobody builds a plain textarea", async () => {
  expect(await scan(/<(Textarea|textarea)\b/, [EDITOR], false)).toEqual([]);
});

test("every bare editor says why it is not the chat's text box", async () => {
  expect(await scan(/<(Editor|EditorField)\b/, OWNERS, true, "components/editor/editor")).toEqual(
    [],
  );
});
