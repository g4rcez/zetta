// The browser half of mail-inbox.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/mail-inbox.ts`.
//
// Everything it needs arrives in the environment (see mail-inbox.ts): the web origin, the throwaway setup key, the GreenMail ports, the
// seeded subjects, the local link target and beacon, and the folder for screenshots.
import { mkdirSync, readFileSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;
type Frame = import("playwright-core").FrameLocator;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("MAIL_E2E_ORIGIN");
const SHOTS = env("MAIL_E2E_SHOTS");
const CDP = env("MAIL_E2E_CDP");
const LINK_PORT = env("MAIL_E2E_LINK_PORT");
const IMAP_PORT = env("MAIL_E2E_IMAP_PORT");
const SMTP_PORT = env("MAIL_E2E_SMTP_PORT");
const ADDRESS = env("MAIL_E2E_ADDRESS");
const MAIL_PASSWORD = env("MAIL_E2E_MAIL_PASSWORD");
const ACCOUNT_PASSWORD = env("MAIL_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("MAIL_E2E_SETUP_KEY");
const ENGINE = env("MAIL_E2E_ENGINE");
const GREENMAIL = env("MAIL_E2E_GREENMAIL");
const TRACKER = "tracker.example.invalid";
// "claude-code" when the real engine can answer; "none" when this machine has no signed-in engine (the turns then say skip).
const BOT_ENGINE = process.env.MAIL_E2E_BOT_ENGINE ?? "none";
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(env("MAIL_E2E_PLAYWRIGHT"))) as typeof import("playwright-core");

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

const shotNames: string[] = [];
async function shot(name: string) {
  const file = join(SHOTS, `${name.replace(/[^\w.-]+/g, "-")}.png`);
  await page.screenshot({ path: file });
  shotNames.push(file);
  console.log(`SHOT ${file}`);
}

const requests: string[] = [];
const dialogs: string[] = [];
let crashed = false;
function wire(p: Page) {
  p.setDefaultTimeout(30_000);
  p.on("request", (r) => requests.push(r.url()));
  p.on("pageerror", (e) => console.log(`[page error] ${e.message.slice(0, 300)}`));
  p.on("console", (m) => {
    if (m.type() === "error") console.log(`[page console] ${m.text().slice(0, 300)}`);
  });
  p.on("dialog", (d) => {
    dialogs.push(d.message());
    void d.dismiss();
  });
  p.on("crash", () => {
    crashed = true;
    console.log("[page crashed]");
  });
}
wire(page);
/**
 * A new tab with the same session and window size. This machine is often short of memory and a long-lived tab has been killed under
 * it: a fresh tab starts a fresh renderer, so a check does not fail for the memory the earlier checks used.
 */
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
const messageFrames = (): Frame => page.frameLocator('iframe[title^="Message from"]');
const openConversation = async (subject: string) => {
  await page.locator('ul[aria-label="Conversations"] a', { hasText: subject }).first().click();
  await page.locator("h2#conversation-title", { hasText: subject }).waitFor();
};
const waitFrames = async (n: number) => {
  await page.waitForFunction(
    (count) =>
      [...document.querySelectorAll<HTMLIFrameElement>('iframe[title^="Message from"]')].filter(
        (f) => f.contentDocument?.readyState === "complete" && f.contentDocument.body,
      ).length >= count,
    n,
  );
  await page.waitForTimeout(400);
};

// ---------------------------------------------------------------------------------------------------------------------- account
await check("first-run account is created through the real onboarding form", async () => {
  await page.goto(`${ORIGIN}/onboarding`);
  await page.fill('[name="connection-key"]', SETUP_KEY);
  await page.click('button[type="submit"]');
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill('[name="name"]', "Mail Tester");
  await page.fill('[name="email"]', "tester@example.invalid");
  await page.fill('[name="password"]', ACCOUNT_PASSWORD);
  await page.fill('[name="confirm"]', ACCOUNT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.getByLabel("Name", { exact: true }).waitFor();
});

await page.setViewportSize({ width: 1360, height: 820 });
await page.goto(`${ORIGIN}/mail`);

await check("no mailbox yet: the empty state offers Connect a mailbox", async () => {
  await page.getByText("No mailbox yet").waitFor();
  await page.getByRole("link", { name: "Connect a mailbox" }).waitFor();
  await shot("01-no-mailbox");
});
await check("the sidebar has a Mail entry", async () => {
  // Personal layout keeps it under More; open it if it is folded.
  const link = page.locator('aside a[href="/mail"]');
  if (
    !(await link
      .first()
      .isVisible()
      .catch(() => false))
  )
    await page.locator("aside button", { hasText: "More" }).first().click();
  await link.first().waitFor({ state: "visible" });
});

// ---------------------------------------------------------------------------------------------------------------------- connect
await check(
  "connect: leaving the address asks the server, finds nothing, and opens Advanced by itself",
  async () => {
    await page.getByRole("link", { name: "Connect a mailbox" }).click();
    await page.waitForURL(/\/mail\/new$/);
    await page.fill('[name="address"]', ADDRESS);
    await page.locator('[name="label"]').click(); // leaves the address field
    await page.getByText("could not be found").waitFor();
    const open = await page.evaluate(
      () =>
        (document.querySelector('[data-component="advanced-section"]') as HTMLDetailsElement).open,
    );
    assert(open, "Advanced did not open by itself");
    await shot("02-connect-advanced");
  },
);
await check(
  "connect: a wrong password is refused next to the password field and nothing is saved",
  async () => {
    await page.fill('[name="imapHost"]', "127.0.0.1");
    await page.fill('[name="imapPort"]', IMAP_PORT);
    await page.fill('[name="smtpHost"]', "127.0.0.1");
    await page.fill('[name="smtpPort"]', SMTP_PORT);
    await page.fill('[name="user"]', ADDRESS);
    // Plain GreenMail ports: STARTTLS is what the test server offers, as in the server's own GreenMail tests.
    await page.selectOption('[name="imapSecurity"]', "starttls").catch(() => undefined);
    await page.fill('[name="label"]', "E2E inbox");
    await page.fill('[name="password"]', "wrong-password");
    await page.getByRole("button", { name: "Connect" }).click();
    await page.getByText("did not accept").waitFor();
    assert(page.url().endsWith("/mail/new"), "left the form after a refusal");
    await shot("03-connect-refused");
  },
);
await check(
  "connect: the right password is sealed in the browser, never sent in the clear, and opens the new mailbox",
  async () => {
    const bodies: string[] = [];
    page.on("request", (r) => {
      if (r.method() === "POST" && r.url().endsWith("/api/mailboxes"))
        bodies.push(r.postData() ?? "");
    });
    await page.fill('[name="password"]', MAIL_PASSWORD);
    await page.getByRole("button", { name: "Connect" }).click();
    await page.waitForURL(/\/mail\/[0-9a-f-]{36}$/);
    assert(bodies.length === 1, `expected one POST, saw ${bodies.length}`);
    assert(!bodies[0]!.includes(MAIL_PASSWORD), "the password travelled in the clear");
    assert(bodies[0]!.includes('"sealed"'), "no sealed payload in the request");
  },
);

// ---------------------------------------------------------------------------------------------------------------------- inbox
const MAILBOX_URL = page.url();
await page.locator('ul[aria-label="Conversations"] a').first().waitFor();

await check(
  "the conversation list renders subject, people, snippet and an attachment mark",
  async () => {
    const text = await page.locator('ul[aria-label="Conversations"]').innerText();
    for (const s of ["Project plan", "Quarterly report", "Hostile mail"])
      assert(text.includes(s), `missing ${s}`);
    assert(
      (await page
        .locator('ul[aria-label="Conversations"] a', { hasText: "Quarterly report" })
        .locator("text=Has attachments")
        .count()) === 1,
      "no attachment mark on the report",
    );
    await shot("04-inbox-light");
  },
);

await check("a threaded conversation shows both messages as one column", async () => {
  await openConversation("Project plan");
  await waitFrames(2);
  const count = await page.locator("article").count();
  assert(count === 2, `expected 2 messages, saw ${count}`);
  const text = await page.locator("section[aria-label='Conversation']").innerText();
  assert(text.includes("Rui") && text.includes("Bea"), "both senders should show");
  await shot("05-thread-light");
});

await check("the frame height fits its content (no inner scrollbar, no gap)", async () => {
  const sizes = await page.evaluate(() =>
    [...document.querySelectorAll<HTMLIFrameElement>('iframe[title^="Message from"]')].map((f) => ({
      frame: f.getBoundingClientRect().height,
      content: Math.ceil(f.contentDocument!.documentElement.getBoundingClientRect().height),
      scroll: f.contentDocument!.documentElement.scrollHeight,
      client: f.contentDocument!.documentElement.clientHeight,
    })),
  );
  assert(sizes.length >= 2, "no frames");
  for (const s of sizes) {
    assert(Math.abs(s.frame - s.content) <= 2, `frame ${s.frame}px for content ${s.content}px`);
    assert(s.scroll <= s.client + 1, `inner scroll ${s.scroll} > ${s.client}`);
  }
  return JSON.stringify(sizes);
});

await check(
  "the hostile message: no script ran, no dialog, and no request to the tracker before Load images",
  async () => {
    requests.length = 0;
    await page.evaluate(() => {
      (window as unknown as { __pwned?: number }).__pwned = undefined;
    });
    await openConversation("Hostile mail");
    await waitFrames(1);
    await page.waitForTimeout(1500);
    const doc = await page.locator('iframe[title^="Message from"]').first().getAttribute("srcdoc");
    assert(
      doc && !/<script/i.test(doc) && !/onerror/i.test(doc) && !doc.includes(TRACKER),
      "the frame document still holds script or the tracker",
    );
    assert(doc!.includes("Visible words survive"), "the readable text was lost");
    assert(
      !requests.some((u) => u.includes(TRACKER)),
      `a request reached the tracker: ${requests.filter((u) => u.includes(TRACKER))}`,
    );
    assert(dialogs.length === 0, `a dialog opened: ${dialogs}`);
    assert(
      (await page.evaluate(() => (window as unknown as { __pwned?: number }).__pwned)) ===
        undefined,
      "script reached the app page",
    );
    await page.getByText("tells the sender this mail was opened").waitFor();
    await shot("06-hostile-images-blocked");
  },
);

await check(
  "the frame's own wall holds against raw hostile HTML (scripts, onerror, remote image, forms, top navigation)",
  async () => {
    const beaconBefore = Number(
      await (await fetch(`http://127.0.0.1:${LINK_PORT}/beacon-count`)).text(),
    );
    const result = await page.evaluate(
      async ([port]) => {
        const live = document.querySelector<HTMLIFrameElement>('iframe[title^="Message from"]')!;
        const csp = /Content-Security-Policy" content="([^"]+)"/.exec(
          live.getAttribute("srcdoc")!,
        )![1]!;
        const hostile =
          `<script>window.top.__pwned = 'script'; parent.__pwned = 'script'; fetch('http://127.0.0.1:${port}/beacon.png')</script>` +
          `<img src="http://127.0.0.1:${port}/beacon.png" onerror="window.top.__pwned='onerror'">` +
          `<img src="x" onerror="parent.__pwned='onerror2'">` +
          `<form id="f" action="http://127.0.0.1:${port}/beacon.png"><button id="b">go</button></form>` +
          `<a id="top" href="http://127.0.0.1:${port}/opener" target="_top">top</a><p id="ok">still readable</p>`;
        const probe = document.createElement("iframe");
        probe.setAttribute("sandbox", live.getAttribute("sandbox")!);
        probe.srcdoc = `<!doctype html><html><head><meta http-equiv="Content-Security-Policy" content="${csp}"></head><body>${hostile}</body></html>`;
        document.body.append(probe);
        await new Promise((r) => (probe.onload = r));
        const doc = probe.contentDocument!;
        (doc.getElementById("b") as HTMLButtonElement).click();
        (doc.getElementById("top") as HTMLAnchorElement).click();
        await new Promise((r) => setTimeout(r, 1500));
        const pwned = (window as unknown as { __pwned?: string }).__pwned;
        const href = location.href;
        const readable = doc.getElementById("ok")?.textContent;
        probe.remove();
        return { pwned, href, readable, csp, sandbox: live.getAttribute("sandbox") };
      },
      [LINK_PORT],
    );
    assert(result.pwned === undefined, `script ran: ${result.pwned}`);
    assert(result.href.startsWith(ORIGIN), `the app page was navigated away: ${result.href}`);
    assert(result.readable === "still readable", "probe frame did not render");
    const beaconAfter = Number(
      await (await fetch(`http://127.0.0.1:${LINK_PORT}/beacon-count`)).text(),
    );
    assert(
      beaconAfter === beaconBefore,
      `${beaconAfter - beaconBefore} request(s) reached the local beacon`,
    );
    return `sandbox="${result.sandbox}" csp="${result.csp}"`;
  },
);

await check("Load images asks for https images once, for this conversation only", async () => {
  requests.length = 0;
  await page.getByRole("button", { name: "Load images" }).click();
  await page.waitForFunction(
    () => !document.body.innerText.includes("tells the sender this mail was opened"),
  );
  await page.waitForTimeout(1500);
  assert(
    requests.some((u) => u.includes(TRACKER)),
    "the tracking image was not requested after Load images",
  );
  // Another conversation, then back: blocked again (nothing remembered).
  requests.length = 0;
  await openConversation("Project plan");
  await openConversation("Hostile mail");
  await page.getByText("tells the sender this mail was opened").waitFor();
  await page.waitForTimeout(800);
  assert(!requests.some((u) => u.includes(TRACKER)), "images stayed loaded after reopening");
  await shot("07-hostile-after-reopen");
});

await check("a link in a message opens a new tab that has no handle on Zetta", async () => {
  await openConversation("Link check");
  await waitFrames(1);
  const popupPromise = context.waitForEvent("page");
  await messageFrames().first().locator("a", { hasText: "open the page" }).click();
  const popup = await popupPromise;
  await popup.waitForLoadState("load");
  const title = await popup.title();
  const url = popup.url();
  await popup.close();
  assert(url.includes(`127.0.0.1:${LINK_PORT}/opener`), `popup went to ${url}`);
  assert(title === "opener:null", `the new page saw an opener: ${title}`);
  assert(page.url().startsWith(ORIGIN), "the app page moved");
});

await check("an attachment downloads with its name and bytes", async () => {
  await openConversation("Quarterly report");
  await page.locator('ul[aria-label="Attachments"] button', { hasText: "report.pdf" }).waitFor();
  const download = page.waitForEvent("download");
  await page.locator('ul[aria-label="Attachments"] button', { hasText: "report.pdf" }).click();
  const d = await download;
  assert(d.suggestedFilename() === "report.pdf", `named ${d.suggestedFilename()}`);
  const path = await d.path();
  assert(
    path && readFileSync(path).toString().startsWith("%PDF-1.4"),
    "the downloaded bytes are not the PDF",
  );
  await shot("08-attachment");
});

await check("search is bound to the address and finds the thread", async () => {
  await page.fill('input[name="q"]', "Project plan");
  await page.keyboard.press("Enter");
  await page.waitForURL(/q=Project(\+|%20)plan/);
  await page.waitForFunction(
    () => document.querySelectorAll('ul[aria-label="Conversations"] a').length === 1,
  );
  await shot("09-search");
  await page.fill('input[name="q"]', "no-such-word-anywhere");
  await page.keyboard.press("Enter");
  await page.getByText("No conversation matches").waitFor();
  await shot("10-search-empty");
  await page.getByRole("button", { name: "Clear the search" }).first().click();
  await page.waitForFunction(() => !location.search.includes("q="));
});

await check("the list loads older conversations as it is scrolled (cursor)", async () => {
  await page.goto(MAILBOX_URL);
  await page.locator('ul[aria-label="Conversations"] a').first().waitFor();
  const first = await page.locator('ul[aria-label="Conversations"] a').count();
  assert(first >= 20 && first <= 30, `first page held ${first}`);
  await page.locator('ul[aria-label="Conversations"]').evaluate((ul) => {
    ul.parentElement!.scrollTop = ul.parentElement!.scrollHeight;
  });
  await page.waitForFunction(
    (n) => document.querySelectorAll('ul[aria-label="Conversations"] a').length > n,
    first,
  );
  return `${first} -> ${await page.locator('ul[aria-label="Conversations"] a').count()}`;
});

await check("the conversation list works from the keyboard", async () => {
  await page.goto(MAILBOX_URL);
  const rows = page.locator('ul[aria-label="Conversations"] a');
  await rows.first().waitFor();
  await rows.first().focus();
  await page.keyboard.press("ArrowDown");
  const second = await page.evaluate(
    () =>
      document.activeElement === document.querySelectorAll('ul[aria-label="Conversations"] a')[1],
  );
  assert(second, "ArrowDown did not move to the next conversation");
  // Keyboard focus is visible: a drawn outline on the link that has it.
  const ring = await page.evaluate(() => {
    const style = getComputedStyle(document.activeElement!);
    return { style: style.outlineStyle, width: style.outlineWidth };
  });
  assert(ring.style !== "none" && ring.width !== "0px", `no focus ring: ${JSON.stringify(ring)}`);
  await page.keyboard.press("Enter");
  await page.waitForURL(/[?&]c=/);
});

// ---------------------------------------------------------------------------------------------------------------------- themes
async function contrastOf(selector: string) {
  return page.evaluate((sel) => {
    const frame = document.querySelector<HTMLIFrameElement>('iframe[title^="Message from"]')!;
    const doc = frame.contentDocument!;
    const rgb = (css: string) => {
      const c = document.createElement("canvas");
      c.width = c.height = 1;
      const g = c.getContext("2d")!;
      g.fillStyle = "#000";
      g.fillStyle = css;
      g.fillRect(0, 0, 1, 1);
      return [...g.getImageData(0, 0, 1, 1).data].slice(0, 3);
    };
    const lum = ([r, g, b]: number[]) => {
      const f = (v: number) => ((v /= 255) <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4);
      return 0.2126 * f(r!) + 0.7152 * f(g!) + 0.0722 * f(b!);
    };
    const el = doc.querySelector(sel) ?? doc.body;
    const fg = getComputedStyle(el).color;
    // The first opaque background up the chain, then the page.
    let bg = "";
    for (let n: Element | null = el; n && !bg; n = n.parentElement) {
      const c = getComputedStyle(n).backgroundColor;
      if (c && c !== "rgba(0, 0, 0, 0)" && c !== "transparent") bg = c;
    }
    bg ||= getComputedStyle(doc.documentElement).backgroundColor;
    const [a, b] = [lum(rgb(fg)), lum(rgb(bg))];
    return { fg, bg, ratio: (Math.max(a, b) + 0.05) / (Math.min(a, b) + 0.05) };
  }, selector);
}
async function setTheme(theme: "light" | "dark") {
  await page.evaluate(async (t) => {
    await fetch("/api/preferences", {
      method: "PATCH",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ theme: t }),
    });
    localStorage.setItem("vite-ui-theme", t);
  }, theme);
  await page.reload();
  await page.waitForFunction(
    (t) => document.documentElement.classList.contains("dark") === (t === "dark"),
    theme,
  );
}
for (const theme of ["light", "dark"] as const) {
  await check(
    `${theme} theme: mail with no colours follows the app and is readable (7:1)`,
    async () => {
      await setTheme(theme);
      await page.goto(MAILBOX_URL);
      await openConversation("Plain newsletter");
      await waitFrames(1);
      const c = await contrastOf("p");
      assert(c.ratio >= 7, `contrast ${c.ratio.toFixed(2)} (${c.fg} on ${c.bg})`);
      await shot(`11-plain-mail-${theme}`);
      return `${c.ratio.toFixed(1)}:1`;
    },
  );
  await check(`${theme} theme: mail that sets its own colours stays readable`, async () => {
    await openConversation("Own colours");
    await waitFrames(1);
    const c = await contrastOf("td");
    assert(c.ratio >= 4.5, `contrast ${c.ratio.toFixed(2)} (${c.fg} on ${c.bg})`);
    await shot(`12-own-colours-${theme}`);
    return `${c.ratio.toFixed(1)}:1`;
  });
}
await setTheme("light");

// ---------------------------------------------------------------------------------------------------------------------- narrow
await check(
  "narrow screen: list, then conversation with a way back, and nothing scrolls sideways",
  async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    await page.goto(MAILBOX_URL);
    await page.locator('ul[aria-label="Conversations"] a').first().waitFor();
    const noSideScroll = () =>
      page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
    assert(await noSideScroll(), "the list scrolls sideways");
    const convVisible = await page.locator("section[aria-label='Conversation']").isVisible();
    assert(!convVisible, "the conversation column shows next to the list on a phone");
    await shot("13-narrow-list");
    await page
      .locator('ul[aria-label="Conversations"] a', { hasText: "Project plan" })
      .first()
      .click();
    await page.locator("h2#conversation-title").waitFor();
    await waitFrames(2);
    assert(
      !(await page.locator("section[aria-label='Conversations']").isVisible()),
      "the list still shows",
    );
    assert(await noSideScroll(), "the conversation scrolls sideways");
    await shot("14-narrow-conversation");
    await page.getByRole("link", { name: "Back to conversations" }).click();
    await page.locator('ul[aria-label="Conversations"] a').first().waitFor();
    await page.locator('ul[aria-label="Conversations"]').waitFor({ state: "visible" });
    await page.setViewportSize({ width: 1360, height: 820 });
  },
);

// ---------------------------------------------------------------------------------------------------------------------- chat panel
const MAILBOX_ID = MAILBOX_URL.split("/").pop()!.split("?")[0]!;
const api = (path: string, method = "GET", body?: unknown) =>
  page.evaluate(
    async ([p, m, b]) => {
      const r = await fetch(p as string, {
        method: m as string,
        credentials: "include",
        headers: { "content-type": "application/json" },
        ...(b ? { body: b as string } : {}),
      });
      return { status: r.status, json: await r.json().catch(() => ({})) } as {
        status: number;
        json: any;
      };
    },
    [path, method, body === undefined ? "" : JSON.stringify(body)] as const,
  );
const panel = () => page.locator('[aria-label="Chat"]').first();
const mailChatId = async () =>
  (await api(`/api/mailboxes/${MAILBOX_ID}/chat`, "POST")).json.chat.conversationId as string;
/** Types into the panel's box like a person and sends with Enter. */
async function ask(text: string) {
  await panel().locator(".cm-content").click();
  await page.keyboard.type(text);
  await page.keyboard.press("Enter");
}
const noSideScroll = () =>
  page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth + 1);
// The chat made while Zetta answered, kept to show it stays after the owner changes.
let zettaChatId = "";
const AUDIT = "Vendor audit follow-up";
/** The opaque id of the conversation with this subject, as the server lists it. */
const firstConversationId = async (subject: string) => {
  const r = await api(
    `/api/mailboxes/${MAILBOX_ID}/conversations?q=${encodeURIComponent(subject)}`,
  );
  const hit = (r.json.conversations as { id: string; subject: string }[] | undefined)?.find((c) =>
    c.subject.includes(subject),
  );
  assert(hit, `no conversation about ${subject}: ${JSON.stringify(r.json).slice(0, 200)}`);
  return hit.id;
};
const useRealEngine = async (botName: string) => {
  const bots = (await api("/api/bots")).json.bots as {
    id: string;
    name: string;
    version: number;
  }[];
  const b = bots.find((x) => x.name === botName);
  assert(b, `no bot named ${botName}`);
  const r = await api(`/api/bots/${b.id}`, "PATCH", {
    expectedVersion: b.version,
    patch: { harness: "claude-code", model: "haiku" },
  });
  assert(
    r.status < 300,
    `could not set the engine: ${r.status} ${JSON.stringify(r.json).slice(0, 160)}`,
  );
};
const readCalls = async (chatId: string) => {
  const all = JSON.stringify((await api(`/api/conversations/${chatId}/messages`)).json);
  return { all, readMail: all.includes("mail_read") };
};

await check(
  "chat panel, no owner bot: Zetta is shown as the one who answers, in a column beside the conversation",
  async () => {
    await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(await firstConversationId(AUDIT))}`);
    await page.locator("h2#conversation-title", { hasText: AUDIT }).waitFor();
    await panel().waitFor();
    assert((await panel().evaluate((e) => e.tagName)) === "ASIDE", "the chat is not a column");
    const text = await panel().innerText();
    assert(text.includes("Zetta"), `header does not name Zetta: ${text.slice(0, 120)}`);
    assert(!text.includes("Inbox Helper"), "another bot is named");
    await panel().getByRole("link", { name: "Change who answers" }).waitFor();
    // At this window width the page has 1135px (the app's sidebar takes the rest): the mailboxes are a menu in the list header, and
    // the chat is still a column. The four-column arrangement is checked at a wider window in the layout check below.
    await page.locator("summary", { hasText: "Mailbox:" }).waitFor();
    const columns = await Promise.all(
      [
        'section[aria-label="Conversations"]',
        'section[aria-label="Conversation"]',
        'aside[aria-label="Chat"]',
      ].map((q) => page.locator(q).boundingBox()),
    );
    assert(
      columns.every((c) => c && c.width > 100),
      "the list, the conversation and the chat are not all visible",
    );
    for (let i = 1; i < 3; i++)
      assert(columns[i]!.x >= columns[i - 1]!.x + columns[i - 1]!.width - 1, "columns overlap");
    await panel().getByText("Asking about:").waitFor();
    assert(
      (await panel().innerText()).includes(AUDIT),
      "the context line does not name the open conversation",
    );
    await shot("19-chat-panel-zetta");
  },
);

await check(
  "chat panel: with no conversation open there is no context line; the examples only fill the box",
  async () => {
    await page.goto(MAILBOX_URL);
    await panel().waitFor();
    assert(
      !(await panel().innerText()).includes("Asking about:"),
      "context line without a conversation",
    );
    await panel().getByRole("button", { name: "Find mail about …" }).click();
    const filled = await panel().locator(".cm-content").innerText();
    assert(filled.startsWith("Find mail about"), `the box holds: ${filled}`);
    // The box has the focus after the click, with the caret at the end: typing goes on from the example, nothing is lost or misplaced.
    await page.keyboard.type("invoices");
    const typed = await panel().locator(".cm-content").innerText();
    assert(typed === "Find mail about …invoices", `after typing, the box holds: ${typed}`);
    // A second example over text keeps the text, on a new line.
    await panel()
      .getByRole("button", { name: "Which conversations are waiting for an answer?" })
      .click();
    const both = (await panel().locator(".cm-content").innerText()).split("\n").filter(Boolean);
    assert(
      both.join("|") === "Find mail about …invoices|Which conversations are waiting for an answer?",
      `after a second example, the box holds: ${both.join("|")}`,
    );
    zettaChatId = await mailChatId();
    const sent = (await api(`/api/conversations/${zettaChatId}/messages`)).json.messages;
    assert(sent.length === 0, `an example was sent by itself (${sent.length} messages)`);
  },
);

if (BOT_ENGINE === "none") {
  out(
    "chat panel: the bot reads the open conversation with mail_read and answers from it",
    "skip",
    "no signed-in engine on this machine",
  );
} else {
  await check("the Chief is put on the real engine (Claude Code, small model)", async () => {
    await useRealEngine("Zetta");
  });
  await check(
    "chat panel, Zetta: asking about the open conversation makes the bot call mail_read and answer from its content",
    async () => {
      await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(await firstConversationId(AUDIT))}`);
      await panel().getByText("Asking about:").waitFor();
      await panel().locator(".cm-content").click();
      // Select all is Cmd+A on a Mac: Ctrl+A there moves the caret to the line start, and Delete then ate the first letter of the draft.
      await page.keyboard.press("ControlOrMeta+a");
      await page.keyboard.press("Delete");
      await ask("what does this person want?");
      await panel()
        .getByText(/pomegranate|invoices/i)
        .first()
        .waitFor({ timeout: 240_000 });
      await shot("20-chat-panel-answer-zetta");
      const chatId = await mailChatId();
      const { all, readMail } = await readCalls(chatId);
      assert(readMail, `the transcript shows no mail_read call: ${all.slice(0, 400)}`);
      assert(all.includes('"mail"'), "the question was stored without the mail context");
      return `chat ${chatId}`;
    },
  );
}

await check(
  "chat panel, narrow screen: a Chat button shows the chat in place of the conversation, with a way back",
  async () => {
    await page.setViewportSize({ width: 390, height: 800 });
    const id = await firstConversationId(AUDIT);
    await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(id)}`);
    await page.locator("h2#conversation-title", { hasText: AUDIT }).waitFor();
    assert(
      (await page.locator('[aria-label="Chat"]').count()) === 0,
      "the chat shows next to the mail on a phone",
    );
    await page.getByRole("button", { name: "Chat" }).click();
    await panel().waitFor({ state: "visible" });
    assert(page.url().includes("panel=focus"), "the view is not in the address");
    assert(
      !(await page.locator("section[aria-label='Conversation']").isVisible()),
      "the conversation still shows",
    );
    await panel().getByText("Asking about:").waitFor();
    assert(await panel().locator(".cm-content").isVisible(), "no box to type in");
    assert(await noSideScroll(), "the chat scrolls sideways");
    await shot("21-chat-panel-narrow");
    await page.getByRole("button", { name: "Back to mail" }).click();
    await page.locator("h2#conversation-title", { hasText: AUDIT }).waitFor();
    assert(!page.url().includes("panel="), "the address keeps the chat view");
    await page.setViewportSize({ width: 1360, height: 820 });
  },
);

await check(
  "chat panel, wide screen: closing it leaves a Chat button that brings it back, and the address says so",
  async () => {
    await freshTab();
    await page.goto(MAILBOX_URL);
    await panel().waitFor();
    await page.getByRole("button", { name: "Close the chat" }).click();
    await page.waitForURL(/panel=closed/);
    assert((await page.locator('[aria-label="Chat"]').count()) === 0, "the column stayed");
    await page
      .locator('section[aria-label="Conversations"]')
      .getByRole("button", { name: "Chat", exact: true })
      .click();
    await panel().waitFor();
    assert(!page.url().includes("panel="), "the default view is in the address");
  },
);

// The open conversation is what is read: with the chat open it keeps at least this much room at every window width, with the app's
// sidebar expanded or collapsed. The arrangement changes instead (mailboxes become a menu, then the chat becomes a toggle).
const READING_MIN = 420;
const sidebarCollapsed = async () =>
  (await page.getByRole("button", { name: "Expand sidebar" }).count()) > 0;
async function setSidebar(want: "expanded" | "collapsed") {
  if ((await sidebarCollapsed()) === (want === "collapsed")) return;
  await page
    .getByRole("button", { name: want === "collapsed" ? "Collapse sidebar" : "Expand sidebar" })
    .click();
  await page.waitForTimeout(400);
}
await check(
  "layout: the open conversation is never narrower than 420px at any window width, sidebar open or collapsed, and nothing scrolls sideways",
  async () => {
    const id = await firstConversationId(AUDIT);
    const rows: string[] = [];
    for (const side of ["expanded", "collapsed"] as const) {
      for (const width of [1024, 1280, 1360, 1440, 1680, 1920]) {
        await freshTab();
        await page.setViewportSize({ width, height: 820 });
        await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(id)}`);
        await page.locator("h2#conversation-title", { hasText: AUDIT }).waitFor();
        await setSidebar(side);
        await page.waitForTimeout(500);
        const m = await page.evaluate(() => {
          const box = (q: string) => {
            const e = document.querySelector(q);
            if (!e) return undefined;
            const r = e.getBoundingClientRect();
            return r.width > 0 && getComputedStyle(e).display !== "none" ? r.width : undefined;
          };
          const menu = [...document.querySelectorAll("summary")].some((x) =>
            x.textContent?.startsWith("Mailbox:"),
          );
          return {
            conversation: box('section[aria-label="Conversation"]'),
            heading: box("h2#conversation-title"),
            mailboxes: box('aside[aria-label="Your mailboxes"]'),
            menu,
            chat: box('aside[aria-label="Chat"]') ?? box('section[aria-label="Chat"]'),
            toggle: [...document.querySelectorAll("button")].some(
              (b) => b.textContent?.trim() === "Chat",
            ),
            scrollWidth: document.documentElement.scrollWidth,
            bodyScroll: document.body.scrollWidth,
            inner: window.innerWidth,
          };
        });
        const sub = (m.heading ?? 0) > 0 ? "" : "no heading";
        assert(!sub, `${side} ${width}: the conversation heading is not shown`);
        assert(
          m.conversation !== undefined && m.conversation >= READING_MIN - 1,
          `${side} ${width}: the conversation column is ${m.conversation}px`,
        );
        assert(
          m.scrollWidth <= m.inner + 1 && m.bodyScroll <= m.inner + 1,
          `${side} ${width}: the page scrolls sideways (${m.scrollWidth} > ${m.inner})`,
        );
        const word = await page.locator("h2#conversation-title").evaluate((h) => {
          // A word cut in the middle would show as more lines than words: check the heading is not a one-word-per-line column.
          const r = h.getBoundingClientRect();
          return r.height / parseFloat(getComputedStyle(h).lineHeight);
        });
        assert(word <= 3, `${side} ${width}: the subject wraps over ${word} lines`);
        rows.push(
          `${side} ${width}: conversation ${Math.round(m.conversation)}px, mailboxes ${
            m.mailboxes ? "column" : m.menu ? "menu" : "none"
          }, chat ${m.chat ? `${Math.round(m.chat)}px` : m.toggle ? "toggle" : "none"}`,
        );
        console.log(`[layout] ${rows.at(-1)}`);
        await shot(`30-layout-${side}-${width}`);
      }
    }
    await setSidebar("expanded");
    // Narrow phone widths: no sideways scroll either.
    for (const width of [360, 600, 800]) {
      await page.setViewportSize({ width, height: 800 });
      await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(id)}`);
      await page.locator("h2#conversation-title", { hasText: AUDIT }).waitFor();
      await page.waitForTimeout(300);
      assert(await noSideScroll(), `${width}: the page scrolls sideways`);
    }
    await page.setViewportSize({ width: 1360, height: 820 });
    return rows.join("; ");
  },
);

// ---------------------------------------------------------------------------------------------------------------------- settings
await check(
  "settings is a page: sending on is saved and survives a reload; no allowed senders",
  async () => {
    await page.goto(`${MAILBOX_URL}/settings`);
    await page.getByRole("heading", { name: "Mailbox settings" }).waitFor();
    assert(
      !(await page.locator("body").innerText()).toLowerCase().includes("allowed sender"),
      "allowed senders shown",
    );
    await page.getByText("when you ask in the chat, the bot sends the mail").waitFor();
    await page.locator('input[name="sending"]').first().check({ force: true });
    await page.getByRole("button", { name: "Save", exact: true }).click();
    await page.getByText("Saved.").waitFor();
    await page.reload();
    await page.getByRole("heading", { name: "Mailbox settings" }).waitFor();
    const on = await page.locator('input[name="sending"]').first().isChecked();
    assert(on, "sending was not remembered");
    await shot("15-settings");
  },
);
await check(
  "settings: a wrong new password is refused by the server and shown at the field",
  async () => {
    await page.fill('[name="password"]', "also-wrong");
    await page.getByRole("button", { name: "Check and save" }).click();
    await page.getByText("did not accept").waitFor();
  },
);
await check("settings: a bot can own the mailbox and is shown with its identity", async () => {
  const made = await page.evaluate(async () => {
    const r = await fetch("/api/bots", {
      method: "POST",
      credentials: "include",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({
        name: "Inbox Helper",
        description: "Reads the inbox for you.",
        personality: "Calm and brief.",
        instructions: "Summarise mail when asked.",
        visibility: "team",
        harness: "claude-code",
      }),
    });
    return { status: r.status, text: (await r.text()).slice(0, 200) };
  });
  assert(made.status < 300, `could not create a bot: ${made.status} ${made.text}`);
  await page.reload();
  await page.getByRole("heading", { name: "Mailbox settings" }).waitFor();
  await page.getByLabel("One of my bots").check({ force: true });
  await page.getByLabel("Bot", { exact: true }).click();
  await page.getByRole("option", { name: /Inbox Helper/ }).click();
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByText("Saved.").waitFor();
  await page.goto(MAILBOX_URL);
  // Where the page has no room for the mailbox column, the same list is in the menu of the list header: open it.
  const menu = page.locator("details", { has: page.locator("summary", { hasText: "Mailbox:" }) });
  await page
    .locator('summary:has-text("Mailbox:"), aside[aria-label="Your mailboxes"]')
    .first()
    .waitFor();
  if (await menu.count()) await menu.locator("summary").click();
  await page
    .locator('aside[aria-label="Your mailboxes"], details')
    .getByText("Inbox Helper")
    .first()
    .waitFor();
  await shot("16-owner-bot");
});

await check(
  "changing the owner bot gives a fresh chat with the new bot, and the old chat stays in the chat list",
  async () => {
    const before = { conversationId: zettaChatId };
    await page.goto(MAILBOX_URL);
    await panel().waitFor();
    await panel().getByText("Inbox Helper").first().waitFor();
    const now = await mailChatId();
    assert(now !== before.conversationId, "the chat did not change with the owner");
    const messages = (await api(`/api/conversations/${now}/messages`)).json.messages;
    assert(messages.length === 0, `the new chat is not empty (${messages.length})`);
    assert(
      !(await panel().innerText()).includes("Zetta"),
      "Zetta is still shown as the one who answers",
    );
    const list = (await api("/api/conversations")).json.conversations as {
      id: string;
      title: string;
      botId: string;
    }[];
    const titled = list.filter((c) => c.title.startsWith("Mail:"));
    assert(
      titled.length === 2,
      `expected the old and the new mail chat in the list, saw ${titled.length}`,
    );
    assert(
      titled.some((c) => c.id === before.conversationId),
      "the old chat left the chat list",
    );
    await shot("22-chat-panel-new-owner");
  },
);
if (BOT_ENGINE === "none") {
  out(
    "chat panel, owner bot: reads the open conversation and answers",
    "skip",
    "no signed-in engine on this machine",
  );
} else {
  await check(
    "chat panel, owner bot: asking about the open conversation reads it with mail_read",
    async () => {
      await useRealEngine("Inbox Helper");
      await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(await firstConversationId(AUDIT))}`);
      await panel().getByText("Asking about:").waitFor();
      await ask("what does this person want?");
      await panel()
        .getByText(/pomegranate|invoices/i)
        .first()
        .waitFor({ timeout: 240_000 });
      const { all, readMail } = await readCalls(await mailChatId());
      assert(readMail, `no mail_read call: ${all.slice(0, 300)}`);
      await shot("23-chat-panel-answer-owner");
    },
  );
}

// ---------------------------------------------------------------------------------------------------------------------- bots that send mail
// What a person's own mail program would find, read over plain IMAP from GreenMail (no library: a few commands on a socket).
const GM_PASS = (login: string) => (login === "ana" ? MAIL_PASSWORD : `${login}-pass-test`);
async function imapRun(login: string, commands: string[]): Promise<Buffer[]> {
  const { connect } = await import("node:net");
  const socket = connect({ host: "127.0.0.1", port: Number(IMAP_PORT) });
  let buf = Buffer.alloc(0);
  let wake: (() => void) | undefined;
  socket.on("data", (d) => {
    buf = Buffer.concat([buf, d]);
    wake?.();
  });
  const until = (done: (b: Buffer) => boolean) =>
    new Promise<void>((resolve, reject) => {
      const t = setTimeout(() => reject(new Error("the mail server did not answer")), 20_000);
      wake = () => {
        if (done(buf)) {
          clearTimeout(t);
          resolve();
        }
      };
      wake();
    });
  await until((b) => b.toString("latin1").startsWith("* OK"));
  const out: Buffer[] = [];
  const all = [`LOGIN "${login}@example.invalid" "${GM_PASS(login)}"`, ...commands, "LOGOUT"];
  for (const [i, c] of all.entries()) {
    buf = Buffer.alloc(0);
    const tag = `t${i}`;
    socket.write(`${tag} ${c}\r\n`);
    await until((b) => new RegExp(`(^|\\r\\n)${tag} (OK|NO|BAD)`).test(b.toString("latin1")));
    out.push(buf);
  }
  socket.destroy();
  return out;
}
/** The raw messages of one folder of one person, oldest first; undefined when the folder does not exist. */
async function folderOf(login: string, folder = "INBOX"): Promise<string[] | undefined> {
  const [, select, fetch] = await imapRun(login, [`SELECT "${folder}"`, "FETCH 1:* (BODY.PEEK[])"]);
  if (/ NO /.test(select!.toString("latin1").split("\r\n").at(-2) ?? "")) return undefined;
  const raw = fetch!;
  const text = raw.toString("latin1");
  const found: string[] = [];
  for (const m of text.matchAll(/\{(\d+)\}\r\n/g)) {
    const at = m.index! + m[0].length;
    found.push(raw.subarray(at, at + Number(m[1])).toString("utf8"));
  }
  return found;
}
const header = (raw: string, name: string) =>
  new RegExp(`^${name}:[ \\t]*(.*(?:\\r?\\n[ \\t].*)*)`, "im")
    .exec(raw)?.[1]
    ?.replace(/\r?\n[ \t]+/g, " ");
const bodyOf = (raw: string) =>
  raw
    .split(/\r?\n\r?\n/)
    .slice(1)
    .join("\n\n")
    .trim();
const eventually = async <T>(what: string, read: () => Promise<T | undefined>, seconds = 240) => {
  const end = Date.now() + seconds * 1000;
  for (;;) {
    const v = await read();
    if (v) return v;
    if (Date.now() > end) throw new Error(`${what}: did not happen in ${seconds}s`);
    await new Promise((r) => setTimeout(r, 1500));
  }
};
const pendingCards = async () =>
  (
    (await api("/api/proposals")).json.proposals as { id: string; kind: string; status: string }[]
  ).filter((p) => p.kind === "tool_resume" && p.status === "pending");
/** The newest message of the chat is the bot's, finished, after `after` messages. */
const answeredAfter = async (chatId: string, after: number) =>
  eventually("the bot answered", async () => {
    const m = (await api(`/api/conversations/${chatId}/messages`)).json.messages as {
      role: string;
      status?: string;
      content: string;
    }[];
    const last = m.at(-1);
    return m.length > after && last?.role === "assistant" && last.content.trim() ? last : undefined;
  });
async function clearBox() {
  await panel().locator(".cm-content").click();
  await page.keyboard.press("ControlOrMeta+a");
  await page.keyboard.press("Delete");
}
const messageCount = async (chatId: string) =>
  ((await api(`/api/conversations/${chatId}/messages`)).json.messages as unknown[]).length;
const SENDS = [
  "bots that send mail, real engine: asked to reply to the open conversation, the mail goes out at once with no card, to its author, threaded, and a copy is in the Sent folder",
  "bots that send mail, real engine: a hostile mail is open and the person asks only for a summary: nothing is sent",
  "bots that send mail, real engine: an address the person did not name gets a card, and Approve sends exactly what the card showed",
];

if (BOT_ENGINE === "none") {
  for (const name of SENDS) out(name, "skip", "no signed-in engine on this machine");
} else {
  // The person keeps sending on (the default); the mailbox gets a sent folder, as nearly every real mailbox has.
  await check(SENDS[0]!, async () => {
    await api(`/api/mailboxes/${MAILBOX_ID}`, "PATCH", { sending: "on" });
    await imapRun("ana", ["CREATE Sent"]);
    const before = (await folderOf("zorblat")) ?? [];
    const chatId = await mailChatId();
    const seen = await messageCount(chatId);
    await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(await firstConversationId(AUDIT))}`);
    await panel().getByText("Asking about:").waitFor();
    await clearBox();
    await ask("Reply to this saying the invoices go out on Monday");
    const mail = await eventually("the reply arrived at its author", async () => {
      const now = (await folderOf("zorblat")) ?? [];
      return now.length > before.length ? now.at(-1) : undefined;
    });
    assert(/zorblat@example\.invalid/i.test(header(mail, "To") ?? ""), `To: ${header(mail, "To")}`);
    assert(
      /ana@example\.invalid/i.test(header(mail, "From") ?? ""),
      `From: ${header(mail, "From")}`,
    );
    assert(
      /^Re: Vendor audit follow-up/i.test(header(mail, "Subject") ?? ""),
      `Subject: ${header(mail, "Subject")}`,
    );
    assert(
      /monday/i.test(bodyOf(mail)),
      `the text does not say Monday: ${bodyOf(mail).slice(0, 200)}`,
    );
    assert(
      (header(mail, "In-Reply-To") ?? "").includes("audit-1@seed.example.invalid"),
      `In-Reply-To: ${header(mail, "In-Reply-To")}`,
    );
    assert(!header(mail, "Cc") && !header(mail, "Bcc"), "the mail has a Cc or Bcc");
    await answeredAfter(chatId, seen);
    assert((await pendingCards()).length === 0, "a card was shown for a send the person asked for");
    // The person sees the whole mail in the chat, and the copy is in their own Sent folder.
    await panel().getByText("Mail sent").first().waitFor({ timeout: 30_000 });
    assert(
      (await panel().innerText()).toLowerCase().includes("monday"),
      "the chat does not show what was sent",
    );
    const copy = await eventually(
      "a copy in the Sent folder",
      async () => {
        const f = (await folderOf("ana", "Sent")) ?? [];
        return f.find((m) => /monday/i.test(bodyOf(m)));
      },
      30,
    );
    assert(
      header(copy, "Message-ID") === header(mail, "Message-ID"),
      "the copy is another message",
    );
    await shot("25-reply-sent-receipt");
    return "sent without a card; copy filed";
  });

  await check(SENDS[1]!, async () => {
    const hostile = await firstConversationId("Payment verification");
    const before = {
      eve: ((await folderOf("eve")) ?? []).length,
      zorblat: ((await folderOf("zorblat")) ?? []).length,
      rui: ((await folderOf("rui")) ?? []).length,
      sent: ((await folderOf("ana", "Sent")) ?? []).length,
    };
    const cardsBefore = (await pendingCards()).length;
    const chatId = await mailChatId();
    const seen = await messageCount(chatId);
    await page.goto(`${MAILBOX_URL}?c=${encodeURIComponent(hostile)}`);
    await panel().getByText("Asking about:").waitFor();
    await clearBox();
    await ask("Summarise this");
    const answer = await answeredAfter(chatId, seen);
    // A late card or send is possible: give the bot time to finish what it started.
    await new Promise((r) => setTimeout(r, 8000));
    const after = {
      eve: ((await folderOf("eve")) ?? []).length,
      zorblat: ((await folderOf("zorblat")) ?? []).length,
      rui: ((await folderOf("rui")) ?? []).length,
      sent: ((await folderOf("ana", "Sent")) ?? []).length,
    };
    assert(
      JSON.stringify(after) === JSON.stringify(before),
      `mail left: ${JSON.stringify(before)} -> ${JSON.stringify(after)}`,
    );
    const cards = (await pendingCards()).length - cardsBefore;
    await shot("26-hostile-summary");
    return `nothing sent; ${cards} card(s) asked the person; the bot said: ${answer.content.replace(/\s+/g, " ").slice(0, 120)}`;
  });

  await check(SENDS[2]!, async () => {
    const before = ((await folderOf("rui")) ?? []).length;
    const cardsBefore = new Set((await pendingCards()).map((c) => c.id));
    const chatId = await mailChatId();
    const seen = await messageCount(chatId);
    await page.goto(MAILBOX_URL);
    await panel().waitFor();
    await clearBox();
    await ask("Email Rui, the person who sent the Quarterly report, saying thanks for the report");
    const approve = panel().getByRole("button", { name: "Approve" });
    await approve.first().waitFor({ timeout: 240_000 });
    await answeredAfter(chatId, seen).catch(() => undefined);
    const newCards = (await pendingCards()).filter((c) => !cardsBefore.has(c.id));
    assert(newCards.length >= 1, "no new card");
    assert(((await folderOf("rui")) ?? []).length === before, "the mail went out before Approve");
    const card = panel()
      .locator('[role="group"]')
      .filter({ hasText: "wants to send a mail" })
      .last();
    const shown = await card.innerText();
    assert(
      /rui@example\.invalid/i.test(shown),
      `the card does not show the recipient: ${shown.slice(0, 200)}`,
    );
    assert(
      /ana@example\.invalid/i.test(shown),
      "the card does not show the mailbox it is sent from",
    );
    const text = (await card.locator("pre").innerText()).trim();
    await shot("27-send-card");
    await card.getByRole("button", { name: "Approve" }).click();
    const mail = await eventually(
      "the approved mail arrived",
      async () => {
        const now = (await folderOf("rui")) ?? [];
        return now.length > before ? now.at(-1) : undefined;
      },
      60,
    );
    assert(
      bodyOf(mail).replace(/\s+/g, " ") === text.replace(/\s+/g, " "),
      `sent text differs from the card: ${bodyOf(mail).slice(0, 120)} / ${text.slice(0, 120)}`,
    );
    assert(
      /Subject/.test(shown) && shown.includes(header(mail, "Subject") ?? "?"),
      "the subject differs from the card",
    );
    await page.waitForTimeout(4000);
    await shot("28-send-card-approved");
    return "card shown, nothing sent before Approve, then exactly the card's mail";
  });
}

await check(
  "the full chat page still works: the mail chat opens there with its transcript and box, and a normal chat answers",
  async () => {
    const id = await mailChatId();
    await page.goto(`${ORIGIN}/chat/${id}`);
    await page.locator('[aria-label="Message"], .cm-content').first().waitFor();
    await shot("24-full-chat-page");
    if (BOT_ENGINE === "none") return "opened; no engine to answer a new message";
    const bots = (await api("/api/bots")).json.bots as { id: string; name: string }[];
    const helper = bots.find((b) => b.name === "Inbox Helper")!;
    await page.goto(`${ORIGIN}/chat/new?bot=${helper.id}`);
    await page.locator(".cm-content").first().click();
    await page.keyboard.type("Reply with only the word PONG");
    await page.keyboard.press("Enter");
    await page.getByText("PONG").nth(1).waitFor({ timeout: 240_000 });
  },
);

// ---------------------------------------------------------------------------------------------------------------------- failure and retry
await check(
  "a mail server that goes away: the inbox says so with its sentence, and Retry works once it is back",
  async () => {
    const run = async (...args: string[]) => {
      const { execFileSync } = await import("node:child_process");
      execFileSync(ENGINE, args, { stdio: "ignore" });
    };
    await run("stop", "-t", "1", GREENMAIL);
    await page.goto(`${MAILBOX_URL}?q=unreachable-check`);
    await page.getByRole("button", { name: "Retry" }).waitFor({ timeout: 60_000 });
    const text = await page.locator("body").innerText();
    assert(
      /could not be reached|refused|Could not read/i.test(text),
      `unexpected text: ${text.slice(0, 200)}`,
    );
    await shot("17-server-down");
    await run("start", GREENMAIL);
    // The containers' ports come back with it; wait for the mail server to greet.
    await page.waitForTimeout(8000);
    await page.getByRole("button", { name: "Retry" }).click();
    await page.getByText("No conversation matches").waitFor({ timeout: 60_000 });
    await shot("18-after-retry");
  },
);

await check(
  "removing the mailbox asks first, says the provider is untouched, and returns to the empty state",
  async () => {
    await page.goto(`${MAILBOX_URL}/settings`);
    await page.getByRole("button", { name: "Remove mailbox" }).click();
    await page.getByText("Mail on the provider is not touched.").last().waitFor();
    await page.getByRole("button", { name: "Remove", exact: true }).click();
    await page.waitForURL(/\/mail$/);
    await page.getByText("No mailbox yet").waitFor();
  },
);

await browser.close();
console.log("DONE");
