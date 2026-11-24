import { expect, test } from "bun:test";
import { Window } from "happy-dom";

import {
  buildFrameDocument,
  defang,
  FRAME_SANDBOX,
  frameCsp,
  linkify,
  PAPER,
  paletteFor,
  setsOwnColors,
  type FramePalette,
} from "./mail-frame";

const APP: FramePalette = {
  scheme: "dark",
  foreground: "#ededf0",
  background: "#0f0f11",
  link: "#47c7a1",
};
const parse = (html: string) => {
  const w = new Window();
  w.document.write(html);
  return w.document;
};

test("the sandbox never lets a script run and never lets a link replace the app", () => {
  const tokens = FRAME_SANDBOX.split(" ");
  expect(tokens).not.toContain("allow-scripts");
  expect(tokens).not.toContain("allow-top-navigation");
  expect(tokens).not.toContain("allow-forms");
  // The height is read from the page, which needs the origin; that is safe only while scripts are off (see the comment on the constant).
  expect(tokens).toContain("allow-same-origin");
  expect(tokens).toContain("allow-popups");
  expect(tokens).toContain("allow-popups-to-escape-sandbox");
});

test("the policy allows nothing but data images and inline styles, and https images only on request", () => {
  expect(frameCsp("blocked")).toBe(
    "default-src 'none'; img-src data:; style-src 'unsafe-inline'; base-uri 'none'; form-action 'none'",
  );
  expect(frameCsp("remote")).toContain("img-src data: https:;");
  expect(frameCsp("remote")).not.toContain("script");
});

test("the document starts with the policy, and the message is the last thing in the body", () => {
  const doc = buildFrameDocument({ html: "<p>Hello</p>", images: "blocked", palette: APP });
  expect(doc.startsWith("<!doctype html>")).toBe(true);
  const policy = doc.indexOf('http-equiv="Content-Security-Policy"');
  expect(policy).toBeGreaterThan(0);
  expect(policy).toBeLessThan(doc.indexOf("<style>"));
  expect(policy).toBeLessThan(doc.indexOf("<p>Hello</p>"));
  expect(doc.endsWith("<p>Hello</p>\n</body></html>")).toBe(true);
});

test("message content cannot break out of the body or add a second policy, a base or a script", () => {
  const hostile =
    '</body></html><meta http-equiv="refresh" content="0;url=https://evil.example.invalid">' +
    '<meta http-equiv="Content-Security-Policy" content="img-src *"><base href="https://evil.example.invalid/">' +
    "<SCRIPT>alert(1)</SCRIPT><style>@import 'x'</style><iframe src=x></iframe><form action=x></form><svg onload=alert(1)>";
  const doc = parse(buildFrameDocument({ html: hostile, images: "blocked", palette: APP }));
  expect(doc.querySelectorAll("meta[http-equiv]").length).toBe(1);
  expect(doc.querySelector("meta[http-equiv]")!.getAttribute("content")).toBe(frameCsp("blocked"));
  expect(doc.querySelectorAll("base,script,iframe,form,svg,link").length).toBe(0);
  expect(doc.querySelectorAll("style").length).toBe(1);
  // The hostile text is still there, as visible text.
  expect(buildFrameDocument({ html: hostile, images: "blocked", palette: APP })).toContain(
    "&lt;SCRIPT>alert(1)",
  );
});

test("defang keeps ordinary mail markup", () => {
  const ok =
    '<table><tr><td style="color:red"><a href="https://a.example.invalid">x</a><img src="data:image/png;base64,AA"></td></tr></table>';
  expect(defang(ok)).toBe(ok);
  expect(defang("<  Meta x><LINK>")).toBe("&lt;Meta x>&lt;LINK>");
});

test("a palette value cannot carry a stylesheet out of its rule", () => {
  const doc = buildFrameDocument({
    html: "x",
    images: "blocked",
    palette: {
      scheme: "dark",
      foreground: "red;}</style><script>1</script>",
      background: "url(x)",
      link: "#abc",
    },
  });
  expect(doc).not.toContain("<script>");
  expect(doc).toContain(`color:${PAPER.foreground}`);
  expect(doc).toContain(`background:${PAPER.background}`);
  expect(doc).toContain("a{color:#abc}");
});

test("mail that sets no colours follows the app, mail that sets its own gets the white page", () => {
  expect(setsOwnColors("<p>Hello <b>there</b></p>")).toBe(false);
  expect(setsOwnColors('<td bgcolor="#fff">')).toBe(true);
  expect(setsOwnColors('<p style="color: #333">x</p>')).toBe(true);
  expect(setsOwnColors('<font color="red">x</font>')).toBe(true);
  expect(paletteFor("<p>plain</p>", APP)).toBe(APP);
  expect(paletteFor('<p style="color:#333">x</p>', APP)).toBe(PAPER);
  const dark = buildFrameDocument({ html: "<p>a</p>", images: "blocked", palette: APP });
  expect(dark).toContain("color-scheme:dark");
  expect(dark).toContain("background:#0f0f11");
});

test("linkify links only http and https addresses and leaves sentence marks out", () => {
  expect(
    linkify("see https://a.example.invalid/x?y=1, then (http://b.example.invalid/p)."),
  ).toEqual([
    { kind: "text", text: "see " },
    {
      kind: "link",
      text: "https://a.example.invalid/x?y=1",
      href: "https://a.example.invalid/x?y=1",
    },
    { kind: "text", text: ", then (" },
    { kind: "link", text: "http://b.example.invalid/p", href: "http://b.example.invalid/p" },
    { kind: "text", text: ")." },
  ]);
  expect(linkify("javascript:alert(1) and data:text/html,x")).toEqual([
    { kind: "text", text: "javascript:alert(1) and data:text/html,x" },
  ]);
  expect(linkify("<script>alert(1)</script>")).toEqual([
    { kind: "text", text: "<script>alert(1)</script>" },
  ]);
  expect(linkify("")).toEqual([]);
  const wiki = linkify("https://x.example.invalid/a_(b)");
  expect(wiki).toEqual([
    {
      kind: "link",
      text: "https://x.example.invalid/a_(b)",
      href: "https://x.example.invalid/a_(b)",
    },
  ]);
});
