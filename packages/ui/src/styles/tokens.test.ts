import { expect, test } from "bun:test";

// DESIGN.md contrast table: every text pair 7:1 or more (WCAG AAA 1.4.6), every non-text indicator 3:1 or more (1.4.11).
// Token values are read from the CSS that ships, so a theme change cannot skip this check.
const globals = await Bun.file(`${import.meta.dir}/globals.css`).text();
const bridge = await Bun.file(`${import.meta.dir}/../../../../apps/web/src/index.css`).text();

const themesCss = await Bun.file(`${import.meta.dir}/../../../../apps/web/src/themes.css`).text();

type Theme = Record<string, string>;

const declarations = (css: string, isTheme: (selector: string) => boolean): Theme => {
  const out: Theme = {};
  for (const [, selectors, body] of css
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .matchAll(/([^{}]+)\{([^{}]*)\}/g)) {
    // At-rules such as `@import …;` sit in front of the first selector; keep only the selector list.
    const list = selectors!.split(";").at(-1)!;
    if (!list.split(",").some((s) => isTheme(s.trim()))) continue;
    for (const [, name, value] of body!.matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g))
      out[name!] = value!.trim();
  }
  return out;
};

const light = {
  ...declarations(globals, (s) => s === ":root"),
  ...declarations(bridge, (s) => s === ":root"),
};
const dark = {
  ...light,
  ...declarations(globals, (s) => s === ".dark"),
  ...declarations(bridge, (s) => s === "html.dark"),
};

// Color themes of apps/web/src/themes.css. A dark one sits on the dark base, a light one on the light base, as in the app.
const SCHEMES = {
  darcula: "dark",
  "darcula-light": "light",
  catppuccin: "dark",
  tokyonight: "dark",
  onedark: "dark",
  nord: "dark",
} as const;
const schemes = Object.entries(SCHEMES).map(
  ([name, base]) =>
    [
      name,
      {
        ...(base === "dark" ? dark : light),
        ...declarations(themesCss, (s) => s === `:root[data-theme="${name}"]`),
      },
    ] as const,
);

test("every theme block in themes.css is checked here", () => {
  const names = [...themesCss.matchAll(/:root\[data-theme="([\w-]+)"\]/g)].map((m) => m[1]);
  expect(names.sort()).toEqual(Object.keys(SCHEMES).sort());
});

const resolve = (theme: Theme, name: string): string => {
  const value = theme[name];
  if (value === undefined) throw new Error(`${name} is not set`);
  const ref = value.match(/^var\((--[\w-]+)\)$/);
  if (ref) return resolve(theme, ref[1]!);
  if (!/^#[0-9a-f]{6}$/i.test(value))
    throw new Error(`${name} must be a #rrggbb value, got ${value}`);
  return value;
};

const channels = (hex: string) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255);
const luminance = (hex: string) => {
  const [r, g, b] = channels(hex).map((c) =>
    c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4,
  );
  return 0.2126 * r! + 0.7152 * g! + 0.0722 * b!;
};
const contrast = (a: string, b: string) => {
  const [hi, lo] = [luminance(a), luminance(b)].sort((x, y) => y - x);
  return (hi! + 0.05) / (lo! + 0.05);
};
// `bg-warn/10` is the color at 10% alpha; the browser composites it over the ground in sRGB.
const tint = (color: string, ground: string) => {
  const c = channels(color);
  return `#${channels(ground)
    .map((g, i) =>
      Math.round((c[i]! * 0.1 + g * 0.9) * 255)
        .toString(16)
        .padStart(2, "0"),
    )
    .join("")}`;
};

const grounds = ["--sidebar", "--background", "--card", "--popover", "--muted", "--accent"];
const status = [
  "--var-color-warn",
  "--var-color-success",
  "--var-color-info",
  "--var-color-danger",
];

for (const [mode, theme] of [["light", light], ["dark", dark], ...schemes] as const) {
  const pair = (fg: string, bg: string, min: number) =>
    test(`${mode}: ${fg} on ${bg} is ${min}:1 or more`, () => {
      expect(contrast(resolve(theme, fg), resolve(theme, bg))).toBeGreaterThanOrEqual(min);
    });

  for (const ground of grounds) {
    pair("--foreground", ground, 7);
    pair("--muted-foreground", ground, 7);
    pair("--primary", ground, 7);
  }
  pair("--primary-foreground", "--primary", 7);
  pair("--attention-foreground", "--attention", 7);
  pair("--var-color-warn-foreground", "--var-color-warn", 7);
  pair("--var-color-success-foreground", "--var-color-success", 7);
  pair("--var-color-info-foreground", "--var-color-info", 7);
  pair("--var-color-danger-foreground", "--var-color-danger", 7);

  for (const color of status)
    for (const ground of ["--background", "--card", "--sidebar"]) pair(color, ground, 7);
  for (const color of status) {
    test(`${mode}: ${color} on its 10% tint is 7:1 or more`, () => {
      const fg = resolve(theme, color);
      expect(contrast(fg, tint(fg, resolve(theme, "--background")))).toBeGreaterThanOrEqual(7);
    });
  }

  for (const ground of ["--background", "--card", "--sidebar"]) {
    pair("--input", ground, 3);
    pair("--ring", ground, 3);
  }
}
