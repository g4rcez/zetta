import { Glob } from "bun";
import { expect, test } from "bun:test";

// CLAUDE.md "Icons without a visible title": an icon-only button, link or menu trigger is wrapped in `<ActionHint>`, so hovering shows
// the library hint (not the slow native `title`). A control with an `aria-label` and visible text says `No hint: <why>` right above it.
// The primitives that build the hint are skipped.
const SKIP = ["components/action-hint.tsx", "components/icon-hint.tsx", "components/ui.tsx"];

// `Hint` (chat sidebar) and `RailHint` (app sidebar) are local wrappers over `ActionHint`.
const HINT = /<(ActionHint|Hint|RailHint)(?=[\s>])/g;

// A control is a tag whose name is a button, a link, or a trigger.
const OPEN = /<(Button|button|Link|a|InputGroupButton|IconButton|[A-Za-z]*Trigger)(?=[\s>/])/g;

/** Reads the opening tag from `start`: up to the `>` that is outside any `{ }` and any string. */
const readTag = (text: string, start: number) => {
  let depth = 0;
  let quote = "";
  for (let i = start; i < text.length; i++) {
    const c = text[i]!;
    if (quote) {
      if (c === quote && text[i - 1] !== "\\") quote = "";
      continue;
    }
    // A `//` comment inside a prop (a handler) may hold an apostrophe: skip it, or it would open a string.
    if (depth > 0 && c === "/" && text[i + 1] === "/") {
      i = text.indexOf("\n", i);
      if (i < 0) break;
      continue;
    }
    if (depth > 0 && (c === '"' || c === "'" || c === "`")) quote = c;
    else if (c === "{") depth++;
    else if (c === "}") depth--;
    else if (depth === 0 && c === '"') quote = c;
    else if (depth === 0 && c === ">" && text[i - 1] !== "=") return text.slice(start, i + 1);
  }
  return text.slice(start);
};

type Control = { file: string; line: number; wrapped: boolean; reasoned: boolean; titled: boolean };

const controls = async () => {
  const found: Control[] = [];
  for await (const file of new Glob("**/*.tsx").scan({ cwd: import.meta.dir })) {
    if (SKIP.includes(file) || file.includes(".test.")) continue;
    const text = await Bun.file(`${import.meta.dir}/${file}`).text();
    for (const match of text.matchAll(OPEN)) {
      const tag = readTag(text, match.index!);
      if (!/\saria-label=/.test(tag)) continue;
      const before = text.slice(0, match.index!);
      const above = before.split("\n").slice(-3).join("\n");
      const previous = before.trimEnd();
      const hint = [...previous.matchAll(HINT)].pop();
      const wrapped =
        !!hint && hint.index! + readTag(previous, hint.index!).length === previous.length;
      found.push({
        file,
        line: before.split("\n").length,
        wrapped,
        reasoned: above.includes("No hint:"),
        titled: /\stitle=/.test(tag),
      });
    }
  }
  return found;
};

test("every control with an aria-label has an ActionHint around it, or says why not", async () => {
  const offenders = (await controls())
    .filter((c) => !c.wrapped && !c.reasoned)
    .map((c) => `${c.file}:${c.line}`);
  expect(offenders).toEqual([]);
});

test("a control with an ActionHint has no native title", async () => {
  const offenders = (await controls())
    .filter((c) => c.wrapped && c.titled)
    .map((c) => `${c.file}:${c.line}`);
  expect(offenders).toEqual([]);
});
