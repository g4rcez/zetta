import { expect, test } from "bun:test";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, relative } from "node:path";

// Runs oxlint on Node: it reads `oxlint.config.ts` and this TypeScript plugin there (Node 22.18+ strips the types natively).
// Drives the real lint rule (`zetta/components-top-level`, see zetta-plugin.ts) so there is one implementation: the rule decides, this
// file checks it on small fixtures and on the whole codebase. CI runs `bun test` but not oxlint, so this is what keeps the rule enforced there.
const ROOT = join(import.meta.dir, "../..");
const RULE = "zetta(components-top-level)";

type Diagnostic = { code: string; message: string; filename: string };

const lint = async (args: string[]) => {
  const run = Bun.spawn(["bunx", "oxlint", "--format", "json", ...args], {
    cwd: ROOT,
    stdout: "pipe",
    stderr: "pipe",
  });
  const out = await new Response(run.stdout).text();
  await run.exited;
  return (JSON.parse(out) as { diagnostics: Diagnostic[] }).diagnostics.filter(
    (d) => d.code === RULE,
  );
};

/** Lints one fixture file with only this rule, from a config that loads the plugin by absolute path. */
const lintFixture = async (source: string, name = "fixture.tsx") => {
  const dir = mkdtempSync(join(tmpdir(), "zetta-lint-"));
  const config = join(dir, "oxlint.config.ts");
  writeFileSync(
    config,
    `export default ${JSON.stringify({
      jsPlugins: [join(ROOT, "tools/oxlint/zetta-plugin.ts")],
      rules: { "zetta/components-top-level": "error" },
    })};`,
  );
  const file = join(dir, name);
  writeFileSync(file, source);
  const found = await lint(["--config", config, file]);
  return found.map((d) => d.message.match(/`([^`]+)`/)![1]);
};

test("flags a helper that returns JSX inside a component", async () => {
  expect(
    await lintFixture(`
      export function Parent() {
        const row = (label: string) => <div>{label}</div>;
        function Inner() { return <span />; }
        const Named = () => <b />;
        const rows = (items: string[]) => items.map((x) => <li key={x} />);
        return <>{row("a")}<Inner /><Named />{rows([])}</>;
      }`),
  ).toEqual(["row", "Inner", "Named", "rows"]);
});

test("flags a JSX-returning function that is not PascalCase, even at the top level", async () => {
  expect(
    await lintFixture(`
      const icon = (I: () => null) => <I />;
      export function useThing() { return <i />; }
      export const memoized = memo(() => <u />);
      export const Fine = () => <i>{icon}{useThing}</i>;`),
  ).toEqual(["icon", "useThing", "memoized"]);
});

test("flags an object-literal entry that returns markup, and allows a one-line hand-off", async () => {
  expect(
    await lintFixture(`
      function Foo() { return null; }
      export const table = {
        Stack: ({ children }: { children: unknown }) => <div>{children as never}</div>,
        draw: (fill: string) => <path fill={fill} />,
        Ok: () => <Foo />,
        okWithProps: (p: object) => <Foo {...p} />,
      };`),
  ).toEqual(["Stack", "draw"]);
});

test("allows top-level components, wrapped components, anonymous callbacks and handlers", async () => {
  expect(
    await lintFixture(`
      export function A() { return <i />; }
      export const B = () => <i />;
      export default function C() { return <i />; }
      const D = memo(function D() { return <i />; });
      const E = forwardRef((p, ref) => <i ref={ref} />);
      export function List({ items }: { items: string[] }) {
        const total = items.length;
        const onPick = (x: string) => void notify(<b>{x}</b>);
        return <ul>{items.map((x) => <li key={x} onClick={() => onPick(x)} />)}<Slot render={() => <u />} />{total}</ul>;
      }`),
  ).toEqual([]);
});

test("skips test files", async () => {
  expect(
    await lintFixture(
      `export function P() { const row = () => <div />; return row(); }`,
      "fixture.test.tsx",
    ),
  ).toEqual([]);
});

test("the codebase has no component inside a component", async () => {
  const found = await lint(["apps", "packages"]);
  expect(found.map((d) => `${relative(ROOT, d.filename)}: ${d.message}`)).toEqual([]);
});
