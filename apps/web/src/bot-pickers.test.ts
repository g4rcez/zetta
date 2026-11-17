import { Glob } from "bun";
import { expect, test } from "bun:test";

// Where a bot is chosen, the person sees what it is for, not only its name: two bots called "Ana" must be told apart. Pick one bot with
// `BotSelect` (components/bot-select.tsx) and several with `BotPicker` (components/bot-picker.tsx); both draw `BotIdentity` with `botRole(bot)`.
// This test fails for a `Select` or a native `<select>` built from the bots as `bots.map((b) => ({ value: b.id, label: b.name }))`
// or as `<option value={b.id}>{b.name}</option>`: those options carry the name only.

/** Files that still build a name-only bot list on purpose. Each entry says who removes it. */
const PENDING: Record<string, string> = {};

// The list a `.map(` runs over: it names the bots. `bots`, `(bots ?? [])`, `others`, `mine`, `specialists`.
const BOT_LIST =
  /(?:\b(?:bots|others|mine|specialists|teamBots|myBots)\b[\s?.\w]*|\(\s*\w*[bB]ots\s*\?\?\s*\[\]\s*\))\.map\(\s*\(?(\w+)\)?\s*=>/g;

/** The lines of `text` that build a bot option from the name alone. */
const nameOnly = (text: string) =>
  [...text.matchAll(BOT_LIST)]
    .filter((m) => {
      const v = m[1]!;
      const body = text.slice(m.index!, m.index! + 320);
      return (
        new RegExp(`value:\\s*${v}\\.id,\\s*label:\\s*${v}\\.name\\b`).test(body) ||
        new RegExp(`<option[^>]*value=\\{${v}\\.id\\}[^>]*>\\s*\\{${v}\\.name\\}`).test(body)
      );
    })
    .map((m) => text.slice(0, m.index!).split("\n").length);

const sources = async () => {
  const out: { file: string; text: string }[] = [];
  for await (const file of new Glob("**/*.tsx").scan({ cwd: import.meta.dir }))
    // `BotSelect` itself maps the bots to options, and gives each one a `Render` with the role.
    if (!file.includes(".test.") && file !== "components/bot-select.tsx")
      out.push({ file, text: await Bun.file(`${import.meta.dir}/${file}`).text() });
  return out;
};

test("no bot is chosen from a list of names alone", async () => {
  const found = (await sources())
    .filter((s) => !(s.file in PENDING))
    .flatMap((s) => nameOnly(s.text).map((line) => `${s.file}:${line}`));
  expect(found).toEqual([]);
});

test("a pending file still holds a name-only bot list: drop its entry when it is fixed", async () => {
  const all = await sources();
  const stale = Object.keys(PENDING).filter(
    (file) => !nameOnly(all.find((s) => s.file === file)?.text ?? "").length,
  );
  expect(stale).toEqual([]);
});
