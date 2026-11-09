import { describe, expect, test } from "bun:test";
import { ARTIFACT_HTML_CSP } from "@zetta/core/artifact-csp";
import { buildAppUi, uiEntryOf, UI_ENTRY } from "./ui-build";

const page = (body = "<h1>Hi</h1>", head = "") =>
  `<!doctype html><html><head><meta charset="utf-8"><title>App</title>${head}</head><body>${body}</body></html>`;
const f = (path: string, content: string) => ({ path, content });
const fails = async (p: Promise<unknown>) => {
  try {
    await p;
  } catch (e) {
    return e as { code: string; detail?: string };
  }
  throw new Error("expected a failure");
};

describe("buildAppUi", () => {
  test("inlines the page's script and style, and puts the policy, design system and bridge before everything else", async () => {
    const { html, bytes } = await buildAppUi({
      entry: UI_ENTRY,
      files: [
        f(
          UI_ENTRY,
          page(
            '<div id="app"></div><script type="module" src="./main.ts"></script>',
            '<link rel="stylesheet" href="./style.css">',
          ),
        ),
        f(
          "ui/main.ts",
          'import { greet } from "./greet";\ndocument.getElementById("app")!.textContent = greet("Zetta");',
        ),
        f("ui/greet.ts", 'export const greet = (n: string) => "Hello " + n;'),
        f("ui/style.css", "#app{color:var(--primary)}"),
      ],
    });
    expect(bytes).toBe(Buffer.byteLength(html));
    const at = (needle: string) => html.indexOf(needle);
    // Order in the head: policy, design system, bridge, console relay, then the page's own markup and style.
    expect(at('http-equiv="Content-Security-Policy"')).toBeGreaterThan(-1);
    expect(at('http-equiv="Content-Security-Policy"')).toBeLessThan(at('id="zetta-design"'));
    expect(at('id="zetta-design"')).toBeLessThan(at("window, 'zetta'"));
    expect(at("window, 'zetta'")).toBeLessThan(at("zetta-playground"));
    expect(at("zetta-playground")).toBeLessThan(at("#app{color:var(--primary)}"));
    expect(html).toContain(ARTIFACT_HTML_CSP);
    // The local files are inside the page; nothing is left to load.
    expect(html).toContain("Hello ");
    expect(html).not.toContain('src="./main.ts"');
    expect(html).not.toContain('href="./style.css"');
    expect(html).toContain('<div id="app"></div>');
  });

  test("a page without a head still has the policy first and keeps its doctype first", async () => {
    const { html } = await buildAppUi({
      entry: UI_ENTRY,
      files: [f(UI_ENTRY, "<!doctype html><p>no head</p>")],
    });
    expect(html.startsWith("<!doctype html>")).toBe(true);
    expect(html.indexOf("Content-Security-Policy")).toBeLessThan(html.indexOf("no head"));
    const bare = await buildAppUi({ entry: UI_ENTRY, files: [f(UI_ENTRY, "<p>no doctype</p>")] });
    expect(bare.html.indexOf("Content-Security-Policy")).toBeLessThan(
      bare.html.indexOf("no doctype"),
    );
  });

  test("a library from a public CDN stays a URL; a bare package is refused and says what to do", async () => {
    const cdn = await buildAppUi({
      entry: UI_ENTRY,
      files: [
        f(UI_ENTRY, page('<script type="module" src="./main.js"></script>')),
        f(
          "ui/main.js",
          'import confetti from "https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm";\nconfetti();',
        ),
      ],
    });
    expect(cdn.html).toContain("https://cdn.jsdelivr.net/npm/canvas-confetti@1/+esm");
    const bare = await fails(
      buildAppUi({
        entry: UI_ENTRY,
        files: [
          f(UI_ENTRY, page('<script type="module" src="./main.js"></script>')),
          f("ui/main.js", 'import React from "react";'),
        ],
      }),
    );
    expect(bare.code).toBe("INVALID");
    expect(bare.detail).toContain("react");
    expect(bare.detail).toContain("cdn.jsdelivr.net");
  });

  test("a script that is not a file of the app, an import that leaves the app, and a macro are refused", async () => {
    expect(
      (
        await fails(
          buildAppUi({
            entry: UI_ENTRY,
            files: [f(UI_ENTRY, page('<script src="./missing.js"></script>'))],
          }),
        )
      ).detail,
    ).toContain("not a file");
    const out = await fails(
      buildAppUi({
        entry: UI_ENTRY,
        files: [
          f(UI_ENTRY, page('<script type="module" src="./main.js"></script>')),
          f("ui/main.js", 'import "../../../etc/passwd";'),
        ],
      }),
    );
    expect(out.code).toBe("INVALID");
    const macro = await fails(
      buildAppUi({
        entry: UI_ENTRY,
        files: [
          f(UI_ENTRY, page('<script type="module" src="./main.ts"></script>')),
          f("ui/main.ts", 'import { x } from "./m" with { type: "macro" };'),
        ],
      }),
    );
    expect(macro.detail).toContain("macro");
  });

  test("a page over 5 MB is refused", async () => {
    const big = await fails(
      buildAppUi({
        entry: UI_ENTRY,
        files: [f(UI_ENTRY, page("<p>" + "a".repeat(5_100_000) + "</p>"))],
      }),
    );
    expect(big.code).toBe("TOO_LARGE");
  });

  test("a script that closes its tag cannot break out of the page", async () => {
    const { html } = await buildAppUi({
      entry: UI_ENTRY,
      files: [
        f(UI_ENTRY, page('<script type="module" src="./main.js"></script>')),
        f("ui/main.js", 'document.title = "</script><img src=x onerror=alert(1)>";'),
      ],
    });
    expect(html).not.toContain("</script><img src=x");
  });
});

describe("uiEntryOf", () => {
  test("ui/index.html is the page of an app that has backend code too", () => {
    expect(
      uiEntryOf([{ path: "index.ts" }, { path: UI_ENTRY }], {
        language: "typescript",
        entry: "index.ts",
      }),
    ).toBe(UI_ENTRY);
  });
  test("an HTML playground is its own page; backend-only has none", () => {
    expect(uiEntryOf([{ path: "page.html" }], { language: "html", entry: "page.html" })).toBe(
      "page.html",
    );
    expect(
      uiEntryOf([{ path: "index.ts" }], { language: "typescript", entry: "index.ts" }),
    ).toBeNull();
    expect(
      uiEntryOf([{ path: "other.html" }], { language: "html", entry: "page.html" }),
    ).toBeNull();
  });
});
