// The browser half of sidebar.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/sidebar.ts`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("SIDEBAR_E2E_ORIGIN");
const SHOTS = env("SIDEBAR_E2E_SHOTS");
const CDP = env("SIDEBAR_E2E_CDP");
const ACCOUNT_PASSWORD = env("SIDEBAR_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("SIDEBAR_E2E_SETUP_KEY");
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(
  env("SIDEBAR_E2E_PLAYWRIGHT")
)) as typeof import("playwright-core");

const out = (name: string, result: "pass" | "fail" | "skip", detail = "") =>
  console.log(`RESULT ${JSON.stringify({ name, result, detail })}`);
async function check(name: string, run: () => Promise<string | void>) {
  if (crashed) await freshTab();
  try {
    out(name, "pass", (await run()) || "");
  } catch (e) {
    out(name, "fail", e instanceof Error ? e.message : String(e));
    await shot(`FAIL-${name}`).catch(() => undefined);
  }
}
const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0]!;
// The first tab, after a pause: a tab opened at once has its first navigation aborted.
await new Promise((r) => setTimeout(r, 3000));
let page: Page = context.pages()[0] ?? (await context.newPage());
page.setDefaultTimeout(30_000);

async function shot(name: string) {
  const file = join(SHOTS, `${name.replace(/[^\w.-]+/g, "-")}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`SHOT ${file}`);
}

let crashed = false;
function wire(p: Page) {
  p.setDefaultTimeout(30_000);
  p.on("pageerror", (e) => console.log(`[page error] ${e.message.slice(0, 300)}`));
  p.on("console", (m) => {
    if (m.type() === "error") console.log(`[page console] ${m.text().slice(0, 300)}`);
  });
  p.on("dialog", (d) => void d.dismiss());
  p.on("crash", () => {
    crashed = true;
    console.log("[page crashed]");
  });
}
wire(page);
/** A new tab with the same session and window size: a long-lived tab has been killed on this machine under memory pressure. */
async function freshTab() {
  const size = page.viewportSize();
  const old = page;
  page = await context.newPage();
  wire(page);
  if (size) await page.setViewportSize(size);
  crashed = false;
  await old.close().catch(() => undefined);
  await new Promise((r) => setTimeout(r, 1000));
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const api = (path: string, method: "GET" | "POST" | "PATCH", data?: unknown) =>
  page.context().request.fetch(`${ORIGIN}${path}`, {
    method,
    headers: { origin: ORIGIN, "content-type": "application/json" },
    ...(data === undefined ? {} : { data }),
  });
const LAYOUT_KEY = "zetta.sidebar-layout";
const setLayout = (layout: "workspace" | "personal") =>
  page.evaluate(([k, v]) => localStorage.setItem(k!, v!), [LAYOUT_KEY, layout]);
/** Opens a page of the app at a window size and waits for the sidebar's own content (the bots list) to be there. */
async function open(width: number, height: number, path = "/tasks") {
  await page.setViewportSize({ width, height });
  await page.goto(`${ORIGIN}${path}`);
  if (width < 768) {
    await page.getByRole("button", { name: "Open navigation" }).click();
    await page.locator("aside").first().waitFor();
  }
  await page.locator('aside nav[aria-label="Main"]').waitFor();
  await page.locator("aside h3", { hasText: "Bots" }).first().waitFor();
  await sleep(700);
}
/** The account's theme is a preference (it wins over the device), so the colour mode is saved there and the next page load applies it. */
const scheme = async (colorScheme: "light" | "dark") => {
  await page.emulateMedia({ colorScheme });
  await api("/api/preferences", "PATCH", { theme: colorScheme });
};

// ---------------------------------------------------------------------------------------------------------------------- account and data
await check("first-run account is created through the real onboarding form", async () => {
  await page.goto(`${ORIGIN}/onboarding`);
  await page.fill('[name="connection-key"]', SETUP_KEY);
  await page.click('button[type="submit"]');
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill('[name="name"]', "Sidebar Tester");
  await page.fill('[name="email"]', "tester@example.invalid");
  await page.fill('[name="password"]', ACCOUNT_PASSWORD);
  await page.fill('[name="confirm"]', ACCOUNT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.getByLabel("Name", { exact: true }).waitFor();
});

const BOTS = [
  "Researcher",
  "Writer with a very long name that has to be cut",
  "Ops",
  "Support",
  "Sales",
  "Analyst",
];
await check("bots, rooms and routines are seeded through the API", async () => {
  const ids: string[] = [];
  for (const name of BOTS) {
    const r = await api("/api/bots", "POST", { name, harness: "fixture" });
    assert(r.ok(), `bot ${name}: ${r.status()} ${await r.text()}`);
    ids.push(((await r.json()) as { bot: { id: string } }).bot.id);
  }
  for (const title of [
    "Launch plan",
    "A room whose title is far too long to fit in the sidebar",
    "Weekly sync",
  ]) {
    const r = await api("/api/discussions", "POST", {
      title,
      members: [{ bot: ids[0] }, { bot: ids[2] }],
    });
    assert(r.ok(), `room ${title}: ${r.status()} ${await r.text()}`);
  }
  for (const title of ["Morning digest", "Weekly report"]) {
    const r = await api("/api/routines", "POST", {
      botId: ids[0],
      title,
      prompt: "Write it.",
      timezone: "UTC",
      dailyAt: "09:00",
    });
    assert(r.ok(), `routine ${title}: ${r.status()} ${await r.text()}`);
  }
  // A new install starts in Simple navigation, which hides Build: the checks need all of it.
  const p = await api("/api/preferences", "PATCH", { navMode: "full" });
  assert(p.ok(), `preferences: ${p.status()} ${await p.text()}`);
  return `${ids.length} bots, 3 rooms, 2 routines`;
});

// ---------------------------------------------------------------------------------------------------------------------- structure
const DESTINATIONS: Record<string, string[]> = {
  People: ["Teams", "Organization", "People"],
  Knowledge: ["Memory", "Skills", "Lessons", "Artifacts"],
  Tools: ["Plugins", "Apps", "Mail"],
  Build: ["Studio", "Playground", "Computer"],
};
const ALL = Object.values(DESTINATIONS).flat();

await check(
  "workspace layout: two named navs, headed sections, every destination once, no toggle",
  async () => {
    await open(1360, 900);
    await setLayout("workspace");
    await page.reload();
    await page.locator('aside nav[aria-label="Workspace"]').waitFor();
    const s = await page.evaluate(() => {
      const aside = document.querySelector("aside")!;
      const text = (e: Element | null) => e?.textContent?.trim().replace(/\s+/g, " ") ?? "";
      return {
        navs: [...aside.querySelectorAll("nav")].map((n) => n.getAttribute("aria-label")),
        headings: [...aside.querySelectorAll("h3")].map(text),
        links: [...aside.querySelectorAll("a")].map(text),
        toggles: [...aside.querySelectorAll("button[aria-expanded]")]
          .filter((b) => !b.hasAttribute("aria-haspopup"))
          .map((b) => text(b) || b.getAttribute("aria-label")),
        lists: [...aside.querySelectorAll("ul[aria-labelledby]")].map((ul) => ({
          name: text(document.getElementById(ul.getAttribute("aria-labelledby")!)),
          links: [...ul.querySelectorAll("a")].map(text),
        })),
      };
    });
    assert(JSON.stringify(s.navs) === '["Main","Workspace"]', `navs: ${s.navs.join(",")}`);
    assert(s.toggles.length === 0, `group toggles present: ${s.toggles.join(" | ")}`);
    for (const [heading, labels] of Object.entries(DESTINATIONS)) {
      assert(s.headings.includes(heading), `heading ${heading} missing: ${s.headings.join(" | ")}`);
      const list = s.lists.find((l) => l.name === heading);
      assert(
        list && JSON.stringify(list.links) === JSON.stringify(labels),
        `list ${heading}: ${JSON.stringify(list)}`,
      );
    }
    for (const label of ALL)
      assert(
        s.links.filter((l) => l === label).length === 1,
        `${label} appears ${s.links.filter((l) => l === label).length} times`,
      );
    assert(!s.links.includes("Bots"), "a Bots link is still in the sidebar");
    return `headings: ${s.headings.join(" | ")}`;
  },
);

await check(
  "the filter finds destinations, hides empty sections and announces the count",
  async () => {
    const input = page.getByRole("searchbox", { name: "Filter the sidebar" });
    await input.waitFor();
    await input.fill("mem");
    await sleep(500);
    const status = page.locator('aside [role="status"][aria-live="polite"]').first();
    const one = await status.innerText();
    const headings = await page.locator('aside nav[aria-label="Workspace"] h3').allInnerTexts();
    assert(one === "1 match", `count says "${one}"`);
    assert(
      headings.includes("Knowledge") && !headings.includes("People") && !headings.includes("Tools"),
      headings.join(" | "),
    );
    await shot("filter-mem");
    await input.fill("zzz");
    await sleep(500);
    assert((await status.innerText()) === "No matches", "no-match text");
    await input.fill("");
    await sleep(300);
    assert((await status.innerText()) === "", "the announcement is cleared with the filter");
  },
);

// ---------------------------------------------------------------------------------------------------------------------- screenshots
await check("screenshots: workspace layout at 1360, 1024 and 390, light and dark", async () => {
  const files: string[] = [];
  for (const [w, h] of [
    [1360, 900],
    [1024, 768],
    [390, 844],
  ] as const)
    for (const mode of ["light", "dark"] as const) {
      await scheme(mode);
      await open(w, h);
      await shot(`workspace-${w}-${mode}`);
      files.push(`${w}-${mode}`);
    }
  return files.join(", ");
});

await check(
  "screenshots: the personal layout and the collapsed rail are unchanged in structure",
  async () => {
    await setLayout("personal");
    const grid = [];
    for (const mode of ["light", "dark"] as const) {
      await scheme(mode);
      await open(1360, 900);
      await shot(`personal-1360-${mode}`);
    }
    const p = await page.evaluate(() => ({
      navs: [...document.querySelectorAll("aside nav")].map((n) => n.getAttribute("aria-label")),
      headings: [...document.querySelectorAll("aside h3")].map((h) => h.textContent?.trim()),
      mainGrid: document
        .querySelector('aside nav[aria-label="Main"]')!
        .className.includes("grid-cols-5"),
      more: !!document.querySelector('aside section[aria-label="More"] button[aria-expanded]'),
    }));
    assert(p.mainGrid && p.more, `personal: ${JSON.stringify(p)}`);
    assert(
      JSON.stringify(p.navs) === '["Main","Rooms and bots"]',
      `personal navs: ${p.navs.join(",")}`,
    );
    grid.push(`navs ${p.navs.join("/")}`);
    await setLayout("workspace");
    for (const mode of ["light", "dark"] as const) {
      await scheme(mode);
      await open(1360, 900);
      await page.getByRole("button", { name: "Collapse sidebar" }).click();
      await sleep(500);
      await shot(`collapsed-1360-${mode}`);
      const c = await page.evaluate(() => ({
        more: !!document.querySelector('aside nav[aria-label="More"]'),
        h3: document.querySelectorAll("aside h3").length,
        workspace: !!document.querySelector('aside nav[aria-label="Workspace"]'),
      }));
      assert(c.more && c.h3 === 0 && !c.workspace, `collapsed: ${JSON.stringify(c)}`);
      await page.getByRole("button", { name: "Expand sidebar" }).click();
      await sleep(500);
    }
    return grid.join("; ");
  },
);

await check("Simple navigation hides Build and the rest stays", async () => {
  await api("/api/preferences", "PATCH", { navMode: "simple" });
  await scheme("light");
  await open(1360, 900);
  const h = await page.locator('aside nav[aria-label="Workspace"] h3').allInnerTexts();
  assert(!h.includes("Build") && h.includes("Tools"), h.join(" | "));
  await shot("workspace-simple-1360-light");
  await api("/api/preferences", "PATCH", { navMode: "full" });
});

// ---------------------------------------------------------------------------------------------------------------------- contrast
await check(
  "heading and row text contrast on the sidebar in every theme (target 4.5:1, the design aims for 7:1)",
  async () => {
    const rows: string[] = [];
    let worst = 99;
    for (const theme of [
      "light",
      "dark",
      "darcula",
      "darcula-light",
      "catppuccin",
      "tokyonight",
      "onedark",
      "nord",
    ]) {
      await api("/api/preferences", "PATCH", { theme });
      await open(1360, 900);
      const r = await page.evaluate(() => {
        const rgba = (css: string) => {
          const c = document.createElement("canvas");
          c.width = c.height = 1;
          const x = c.getContext("2d", { willReadFrequently: true })!;
          x.clearRect(0, 0, 1, 1);
          x.fillStyle = css;
          x.fillRect(0, 0, 1, 1);
          const d = x.getImageData(0, 0, 1, 1).data;
          return [d[0]!, d[1]!, d[2]!, d[3]! / 255] as const;
        };
        const lum = ([r, g, b]: readonly number[]) => {
          const f = (v: number) =>
            (v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
          return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
        };
        const bg = rgba(getComputedStyle(document.querySelector("aside")!).backgroundColor);
        const ratio = (el: Element) => {
          const fg = rgba(getComputedStyle(el).color);
          const mix = [0, 1, 2].map((i) => fg[i]! * fg[3] + bg[i]! * (1 - fg[3]));
          const [a, b] = [lum(mix), lum(bg)];
          return (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05);
        };
        const heading = [...document.querySelectorAll("aside nav[aria-label=Workspace] h3")].find(
          (h) => h.textContent?.trim() === "Knowledge",
        )!;
        const link = [...document.querySelectorAll("aside nav[aria-label=Workspace] a")].find(
          (a) => a.textContent?.trim() === "Memory",
        )!;
        const mainLink = [...document.querySelectorAll("aside nav[aria-label=Main] a")].find(
          (a) => a.textContent?.trim() === "Tasks",
        )!;
        return { heading: ratio(heading), link: ratio(link), main: ratio(mainLink) };
      });
      worst = Math.min(worst, r.heading, r.link, r.main);
      rows.push(
        `${theme}: heading ${r.heading.toFixed(1)}, row ${r.link.toFixed(1)}, main ${r.main.toFixed(1)}`,
      );
    }
    await api("/api/preferences", "PATCH", { theme: null });
    console.log(`[contrast] ${rows.join(" | ")}`);
    assert(worst >= 4.5, `lowest ratio ${worst.toFixed(2)}: ${rows.join(" | ")}`);
    return `lowest ${worst.toFixed(1)}:1. ${rows.join(" | ")}`;
  },
);

// ---------------------------------------------------------------------------------------------------------------------- keyboard
await check("keyboard: Tab order, visible focus ring, arrows, Home/End and Enter", async () => {
  await scheme("light");
  await open(1360, 900);
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  type Stop = { name: string; where: string; ring: boolean };
  const stops: Stop[] = [];
  const read = () =>
    page.evaluate(() => {
      const el = document.activeElement as HTMLElement | null;
      if (!el || el === document.body) return null;
      const cs = getComputedStyle(el);
      const name =
        el.getAttribute("aria-label") ||
        el.innerText?.trim().split("\n")[0] ||
        el.getAttribute("title") ||
        el.tagName;
      const where =
        el.closest("nav")?.getAttribute("aria-label") ??
        (el.closest("aside") ? (el.closest("div.border-t") ? "footer" : "header") : "outside");
      return {
        name: name.slice(0, 40),
        where,
        ring: cs.outlineStyle !== "none" && parseFloat(cs.outlineWidth) > 0,
      };
    });
  for (let i = 0; i < 90; i++) {
    await page.keyboard.press("Tab");
    const s = await read();
    if (!s) break;
    if (s.where === "outside") break;
    stops.push(s);
  }
  const order = stops.map((s) => `${s.where}:${s.name}`);
  console.log(`[focus order] ${order.join(" > ")}`);
  const first = (w: string) => stops.findIndex((s) => s.where === w);
  const last = (w: string) => stops.map((s) => s.where).lastIndexOf(w);
  const inputAt = stops.findIndex((s) => s.name.startsWith("Filter"));
  assert(stops[0]?.where === "header", `first stop is ${stops[0]?.where}`);
  assert(
    first("Main") > first("header") && last("Main") < inputAt,
    "Main links come after the header and before the filter",
  );
  assert(inputAt > 0 && first("Workspace") > inputAt, "the filter comes before the sections");
  assert(first("footer") > last("Workspace"), "the footer comes after the sections");
  const noRing = stops.filter((s) => !s.ring).map((s) => s.name);
  assert(noRing.length === 0, `no visible focus ring on: ${noRing.join(" | ")}`);
  out("keyboard: focus order recorded", "pass", `${stops.length} stops. ${order.join(" > ")}`);

  // Arrows, Home, End in the Workspace nav: start on its first row with a real Tab from the filter.
  const labelNow = () =>
    page.evaluate(() => (document.activeElement as HTMLElement).innerText.trim().split("\n")[0]);
  await page.getByRole("searchbox", { name: "Filter the sidebar" }).focus();
  const rowCount = await page
    .locator("aside nav[aria-label=Workspace] :is([data-chat-row],[data-walk] a)")
    .count();
  let firstRow = "";
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    const inRow = await page.evaluate(() =>
      (document.activeElement as HTMLElement).matches("[data-chat-row], [data-walk] a"),
    );
    if (inRow) {
      firstRow = await labelNow();
      break;
    }
  }
  assert(firstRow, "Tab from the filter did not reach a row");
  await page.keyboard.press("ArrowDown");
  const second = await labelNow();
  assert(second !== firstRow, "ArrowDown did not move");
  await page.keyboard.press("ArrowUp");
  assert((await labelNow()) === firstRow, "ArrowUp did not come back");
  await page.keyboard.press("End");
  const lastRow = await labelNow();
  assert(lastRow === "Computer", `End went to "${lastRow}"`);
  await page.keyboard.press("Home");
  assert((await labelNow()) === firstRow, "Home did not return to the first row");
  // Down to Memory with the arrow keys alone, then Enter opens it.
  await page.keyboard.press("End");
  let guard = 0;
  while ((await labelNow()) !== "Memory" && guard++ < 40) await page.keyboard.press("ArrowUp");
  assert((await labelNow()) === "Memory", "Memory was not reached with the arrows");
  await page.keyboard.press("Enter");
  await page.waitForURL(/\/memory/);
  return `${rowCount} rows; first "${firstRow}", End "Computer", Enter on Memory opened ${new URL(page.url()).pathname}`;
});

// ---------------------------------------------------------------------------------------------------------------------- motion
await check(
  "reduced motion: nothing animates when a group opens; with motion on it fades, with no height change",
  async () => {
    await setLayout("personal");
    await page.emulateMedia({ reducedMotion: "reduce", colorScheme: "light" });
    await open(1360, 900);
    const sample = () =>
      page.evaluate(async () => {
        const btn = [...document.querySelectorAll("aside section[aria-label] button")].find(
          (b) => b.textContent?.trim() === "More",
        ) as HTMLElement;
        const was = btn.getAttribute("aria-expanded") === "true";
        btn.click();
        await new Promise((r) => requestAnimationFrame(() => r(null)));
        const ul = document.querySelector(
          'aside section[aria-label="More"] ul',
        ) as HTMLElement | null;
        if (!ul) return { was, found: false };
        const heights = new Set<number>();
        const t0 = performance.now();
        while (performance.now() - t0 < 300) {
          heights.add(Math.round(ul.getBoundingClientRect().height));
          await new Promise((r) => requestAnimationFrame(() => r(null)));
        }
        const cs = getComputedStyle(ul);
        return {
          was,
          found: true,
          animationName: cs.animationName,
          duration: cs.animationDuration,
          running: ul.getAnimations().length,
          heights: [...heights],
          subtree: document
            .getAnimations()
            .filter((a) => ul.contains((a.effect as KeyframeEffect | null)?.target ?? null)).length,
        };
      });
    let r = await sample();
    if (!r.found) r = await sample(); // it started open: close it, then open it again
    if (r.was) r = await sample();
    assert(r.found, "More did not open");
    assert(
      r.animationName === "none" && r.running === 0 && r.subtree === 0,
      `reduced motion still animates: ${JSON.stringify(r)}`,
    );
    assert(r.heights?.length === 1, `height changed: ${r.heights}`);
    const reduced = JSON.stringify(r);
    await page.emulateMedia({ reducedMotion: "no-preference" });
    await page.reload();
    await page.locator('aside section[aria-label="More"]').waitFor();
    await sleep(500);
    // Close, then open by hand: the rows fade in over 120ms and the height stays put.
    const close = await sample();
    const open2 = close.found ? await sample() : close;
    const r2 = open2.found ? open2 : await sample();
    assert(r2.animationName === "nav-reveal-in", `expected the fade, got ${JSON.stringify(r2)}`);
    assert(r2.duration === "0.12s", `duration ${r2.duration}`);
    assert(r2.heights?.length === 1, `height changed while opening: ${r2.heights}`);
    await setLayout("workspace");
    return `reduced: ${reduced}; normal: ${JSON.stringify(r2)}`;
  },
);

await check("reduced motion: the workspace sidebar has no running animation on load", async () => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await open(1360, 900);
  const running = await page.evaluate(() =>
    document
      .getAnimations()
      .filter(
        (a) =>
          document
            .querySelector("aside")!
            .contains((a.effect as KeyframeEffect | null)?.target ?? null) &&
          a.playState === "running",
      )
      .map((a) => (a as CSSAnimation).animationName ?? a.constructor.name),
  );
  await page.emulateMedia({ reducedMotion: "no-preference" });
  assert(running.length === 0, `running: ${running.join(",")}`);
});

// ---------------------------------------------------------------------------------------------------------------------- clicks
await check(
  "clicks to reach each grouped destination: 1 now (2 before, from the code: open the group, then the link)",
  async () => {
    const results: string[] = [];
    const paths: Record<string, RegExp> = {
      Teams: /\/teams/,
      Organization: /\/organization/,
      People: /\/people/,
      Memory: /\/memory/,
      Skills: /\/skills/,
      Lessons: /\/lessons/,
      Artifacts: /\/artifacts/,
      Plugins: /\/studio\/plugins|\/plugins/,
      Apps: /\/apps/,
      Mail: /\/mail/,
      Studio: /\/studio/,
      Playground: /\/playground/,
      Computer: /\/studio\/computer/,
    };
    for (const label of ALL) {
      await open(1360, 900, "/tasks");
      let clicks = 0;
      const link = page
        .locator("aside nav[aria-label=Workspace]")
        .getByRole("link", { name: label, exact: true });
      // Before any click, is it already visible? If not, a group toggle would have to be opened first.
      if (!(await link.isVisible())) {
        const toggle = page.locator("aside button[aria-expanded=false]").first();
        await toggle.click();
        clicks++;
      }
      await link.scrollIntoViewIfNeeded();
      await link.click();
      clicks++;
      await page.waitForURL(paths[label]!);
      assert(clicks === 1, `${label} took ${clicks} clicks`);
      results.push(`${label}=${clicks}`);
    }
    return results.join(", ");
  },
);

// ---------------------------------------------------------------------------------------------------------------------- short window
await check(
  "a short window scrolls the destination list and keeps the footer in reach",
  async () => {
    await scheme("light");
    await open(1360, 700, "/tasks");
    const m = await page.evaluate(() => {
      const nav = document.querySelector("aside nav[aria-label=Workspace]") as HTMLElement;
      const footer = document.querySelector("aside > div.border-t") as HTMLElement;
      const theme = [...document.querySelectorAll("aside button")].find((b) =>
        b.textContent?.includes("change theme"),
      ) as HTMLElement;
      const account = footer.querySelector("button:last-of-type, a:last-of-type") as HTMLElement;
      const fb = footer.getBoundingClientRect();
      return {
        scrolls: nav.scrollHeight > nav.clientHeight,
        navScroll: `${nav.clientHeight}/${nav.scrollHeight}`,
        footerBottom: Math.round(fb.bottom),
        themeVisible: theme.getBoundingClientRect().bottom <= innerHeight,
        accountVisible: account.getBoundingClientRect().bottom <= innerHeight,
        pageScroll: document.scrollingElement!.scrollHeight > innerHeight,
      };
    });
    assert(m.scrolls, `the list does not scroll: ${JSON.stringify(m)}`);
    assert(
      m.footerBottom <= 700 && m.themeVisible && m.accountVisible,
      `footer out of reach: ${JSON.stringify(m)}`,
    );
    assert(!m.pageScroll, "the page itself scrolls");
    await shot("short-window-700-top");
    const last = page
      .locator("aside nav[aria-label=Workspace]")
      .getByRole("link", { name: "Computer", exact: true });
    await last.scrollIntoViewIfNeeded();
    assert(await last.isVisible(), "the last row cannot be scrolled into view");
    await shot("short-window-700-scrolled");
    return JSON.stringify(m);
  },
);

// ---------------------------------------------------------------------------------------------------------------------- target size
await check("row and button targets are at least 24px", async () => {
  await open(1360, 900);
  const small = await page.evaluate(() =>
    [...document.querySelectorAll("aside a, aside button, aside input")]
      .map((el) => ({ el, r: el.getBoundingClientRect() }))
      .filter(({ r }) => r.width > 0 && r.height > 0 && (r.width < 24 || r.height < 24))
      .map(
        ({ el, r }) =>
          `${el.getAttribute("aria-label") ?? el.textContent?.trim().slice(0, 20)} ${Math.round(r.width)}x${Math.round(r.height)}`,
      ),
  );
  assert(small.length === 0, `smaller than 24px: ${small.join(" | ")}`);
});

console.log("DONE");
process.exit(0);
