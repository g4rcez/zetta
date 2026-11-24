import { describe, expect, test } from "bun:test";
import {
  htmlToText,
  imageTypeOf,
  referencedCids,
  sanitizeMailHtml,
  SANITIZE_LIMITS,
} from "./sanitize";

const clean = (h: string, o?: Parameters<typeof sanitizeMailHtml>[1]) =>
  sanitizeMailHtml(h, o).html;
const PNG = new Uint8Array([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
]);

describe("scripts and handlers", () => {
  test("script is removed with its text", () => {
    const out = clean("<p>hi</p><script>alert(1)</script>");
    expect(out).toBe("<p>hi</p>");
  });
  test("event handlers are removed", () => {
    const out = clean(
      '<img src="https://x.example.invalid/a.png" onerror="alert(1)"><p onclick="x()" onmouseover=y()>t</p>',
    );
    expect(out).not.toMatch(/on\w+\s*=/i);
    expect(out).toContain("<p>t</p>");
    expect(clean('<body onload="alert(1)"><div onLoad="x">a</div></body>')).not.toMatch(/onload/i);
  });
  test("javascript: links in several encodings lose their href", () => {
    for (const href of [
      "javascript:alert(1)",
      "JaVaScRiPt:alert(1)",
      "  javascript:alert(1)",
      "java\tscript:alert(1)",
      "java&#x09;script:alert(1)",
      "&#106;avascript:alert(1)",
      "&#x6A;&#x61;vascript&colon;alert(1)",
      "jav&#x0A;ascript:alert(1)",
      "vbscript:msgbox(1)",
      "\u0001javascript:alert(1)",
      "//evil.example.invalid/x",
      "/relative",
    ]) {
      const out = clean(`<a href="${href}">x</a>`);
      expect(out).not.toMatch(/href/i);
      expect(out.toLowerCase()).not.toContain("javascript");
    }
  });
  test("data:text/html link is removed", () => {
    expect(clean('<a href="data:text/html;base64,PHNjcmlwdD4=">x</a>')).not.toContain("data:");
  });
  test("http, https and mailto links stay and are opened safely", () => {
    for (const href of [
      "https://a.example.invalid/x?y=1",
      "http://a.example.invalid",
      "mailto:a@example.invalid",
    ]) {
      const out = clean(`<a href="${href}" target="_self" rel="opener">x</a>`);
      expect(out).toContain(`href="${href}"`);
      expect(out).toContain('target="_blank"');
      expect(out).toContain('rel="noopener noreferrer nofollow"');
      expect(out).not.toContain("_self");
      expect(out).not.toContain('"opener"');
    }
  });
});

describe("elements that never survive", () => {
  test.each([
    ["base", '<base href="https://evil.example.invalid/"><p>a</p>'],
    [
      "meta refresh",
      '<meta http-equiv="refresh" content="0;url=https://evil.example.invalid"><p>a</p>',
    ],
    ["link", '<link rel="stylesheet" href="https://evil.example.invalid/a.css"><p>a</p>'],
    ["iframe", '<iframe src="https://evil.example.invalid"></iframe><p>a</p>'],
    ["object", '<object data="https://evil.example.invalid/a.swf"></object><p>a</p>'],
    ["embed", '<embed src="https://evil.example.invalid/a.swf"><p>a</p>'],
    [
      "svg with script",
      '<svg onload="alert(1)"><script>alert(1)</script><text>boo</text></svg><p>a</p>',
    ],
    ["math", '<math><mi xlink:href="javascript:alert(1)">x</mi></math><p>a</p>'],
    [
      "form",
      '<form action="https://evil.example.invalid" method="post"><input name="p" type="password"><button>go</button></form><p>a</p>',
    ],
    [
      "style tag",
      "<style>@import url(https://evil.example.invalid/a.css); p{background:url(https://evil.example.invalid/b.png)}</style><p>a</p>",
    ],
    ["noscript", "<noscript><img src=https://evil.example.invalid/x.png></noscript><p>a</p>"],
  ])("%s", (_n, html) => {
    const out = clean(html);
    expect(out).not.toMatch(
      /<(base|meta|link|iframe|object|embed|svg|math|form|input|button|style|script|noscript)\b/i,
    );
    expect(out).not.toContain("evil.example.invalid");
    expect(out).not.toMatch(/boo|@import|alert/);
    expect(out).toContain("<p>a</p>");
  });
});

describe("css", () => {
  test("url(), @import, expression and escapes are dropped from a style; plain colours stay", () => {
    for (const style of [
      "background:url(https://evil.example.invalid/b.png)",
      "background-image:url('https://evil.example.invalid/b.png')",
      "color:red;background-color:URL(https://evil.example.invalid)",
      "width:expression(alert(1))",
      "background:\\75rl(https://evil.example.invalid)",
      "color:red;@import 'https://evil.example.invalid/a.css'",
      "behavior:url(x.htc)",
      "position:fixed;top:0",
    ]) {
      const out = clean(`<div style="${style}">t</div>`);
      expect(out).not.toMatch(/url|import|expression|evil|behavior|position/i);
    }
    expect(clean('<div style="color:#336699;text-align:center;background:url(x)">t</div>')).toBe(
      '<div style="color:#336699;text-align:center">t</div>',
    );
  });
  test("a legacy background attribute is dropped", () => {
    expect(
      clean(
        '<table background="https://evil.example.invalid/a.png"><tr><td background="cid:x">a</td></tr></table>',
      ),
    ).not.toMatch(/background|evil/);
  });
});

describe("images", () => {
  const pixel = '<p>hi</p><img src="https://track.example.invalid/p.gif?u=1" width="1" height="1">';
  test("a remote image is removed by default and the result says so", () => {
    const r = sanitizeMailHtml(pixel);
    expect(r.html).toBe("<p>hi</p>");
    expect(r.remoteImages).toBe("removed");
    expect(sanitizeMailHtml(pixel, { images: "blocked" }).remoteImages).toBe("removed");
  });
  test("a message without remote images reports none", () => {
    expect(sanitizeMailHtml("<p>hi</p>").remoteImages).toBe("none");
  });
  test("asked to keep them, https images stay (no referrer) and the result says shown", () => {
    const r = sanitizeMailHtml(pixel, { images: "remote" });
    expect(r.html).toContain('src="https://track.example.invalid/p.gif?u=1"');
    expect(r.html).toContain('referrerpolicy="no-referrer"');
    expect(r.remoteImages).toBe("shown");
  });
  test("http, protocol-relative and sender data: images are never kept", () => {
    for (const src of [
      "http://a.example.invalid/a.png",
      "//a.example.invalid/a.png",
      "data:image/png;base64,AAAA",
      "data:image/svg+xml,<svg/>",
      "/a.png",
    ]) {
      const r = sanitizeMailHtml(`<img src="${src}">`, { images: "remote" });
      expect(r.html).toBe("");
      expect(r.remoteImages).toBe("none");
    }
  });
  test("a cid image becomes a data URL from the message's own part", () => {
    const r = sanitizeMailHtml('<p>a</p><img src="cid:Logo@x" alt="logo">', {
      inline: new Map([["logo@x", { contentType: "image/png", bytes: PNG }]]),
    });
    expect(r.html).toMatch(/src="data:image\/png;base64,[A-Za-z0-9+/=]+"/);
    expect(r.html).toContain('alt="logo"');
    expect(r.inlineImages).toBe(1);
  });
  test("an oversized inline image is skipped", () => {
    const big = new Uint8Array(SANITIZE_LIMITS.inlineImageBytes + 1);
    big.set(PNG);
    const r = sanitizeMailHtml('<img src="cid:big">', {
      inline: new Map([["big", { contentType: "image/png", bytes: big }]]),
    });
    expect(r.html).toBe("");
    expect(r.inlineImages).toBe(0);
  });
  test("the message total is capped", () => {
    const part = new Uint8Array(400_000);
    part.set(PNG);
    const inline = new Map(
      [1, 2, 3, 4].map((n) => [`i${n}`, { contentType: "image/png", bytes: part }] as const),
    );
    const r = sanitizeMailHtml([1, 2, 3, 4].map((n) => `<img src="cid:i${n}">`).join(""), {
      inline,
    });
    expect(r.inlineImages).toBe(3);
  });
  test("svg and non-image bytes are never inlined, whatever the declared type", () => {
    const svg = new TextEncoder().encode(
      '<svg xmlns="http://www.w3.org/2000/svg" onload="alert(1)"/>',
    );
    const html = new TextEncoder().encode("<script>alert(1)</script>");
    const r = sanitizeMailHtml('<img src="cid:a"><img src="cid:b">', {
      inline: new Map([
        ["a", { contentType: "image/png", bytes: svg }],
        ["b", { contentType: "image/png", bytes: html }],
      ]),
    });
    expect(r.html).toBe("");
    expect(imageTypeOf(svg)).toBeUndefined();
  });
  test("a cid with nothing behind it is removed", () => {
    expect(clean('<img src="cid:nothing">')).toBe("");
  });
  test("referencedCids lists what the html points to", () => {
    expect(
      referencedCids(
        `<img src="cid:A@x"><img src='cid:b%40y'><img src=cid:c><img src="https://a.example.invalid/x"><img src="cid:a@x">`,
      ),
    ).toEqual(["a@x", "b@y", "c"]);
  });
});

describe("shape", () => {
  test("empty html needs no html", () => {
    expect(sanitizeMailHtml("")).toEqual({
      html: "",
      remoteImages: "none",
      inlineImages: 0,
      size: "ok",
    });
  });
  test("a very long message is left out and says so", () => {
    const r = sanitizeMailHtml(`<p>${"a".repeat(SANITIZE_LIMITS.htmlChars + 10)}</p>`);
    expect(r.html).toBe("");
    expect(r.size).toBe("too_large");
  });
  test("ordinary formatting survives", () => {
    const out = clean(
      '<div dir="ltr"><b>Bold</b> <i>it</i><ul><li>a</li></ul><table><tr><td align="center" style="color:#000">x</td></tr></table></div>',
    );
    expect(out).toContain("<b>Bold</b>");
    expect(out).toContain("<li>a</li>");
    expect(out).toContain('<td align="center" style="color:#000">x</td>');
  });
});

describe("html as plain text", () => {
  test("tags, scripts, styles and the head go; blocks and breaks become lines", () => {
    expect(
      htmlToText(
        "<html><head><title>t</title><style>p{}</style></head><body><p>One</p><div>Two<br>three</div><script>x()</script><ul><li>a</li><li>b</li></ul></body></html>",
      ),
    ).toBe("One\nTwo\nthree\na\nb");
  });
  test("link addresses and image sources are dropped, and entities are read", () => {
    const out = htmlToText(
      '<p>Tom &amp; Jerry &quot;ok&quot; <a href="https://x.example.invalid/p">link</a><img src="https://t.example.invalid/p.gif"></p>',
    );
    expect(out).toBe('Tom & Jerry "ok" link');
  });
  test("empty and whitespace-only html give an empty string", () => {
    expect(htmlToText("")).toBe("");
    expect(htmlToText("  \n ")).toBe("");
  });
});
