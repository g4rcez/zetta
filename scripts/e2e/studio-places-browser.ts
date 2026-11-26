// The browser half of studio-places.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/studio-places.ts`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("PLACES_E2E_ORIGIN");
const SHOTS = env("PLACES_E2E_SHOTS");
const CDP = env("PLACES_E2E_CDP");
const ACCOUNT_PASSWORD = env("PLACES_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("PLACES_E2E_SETUP_KEY");
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(
  env("PLACES_E2E_PLAYWRIGHT")
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

const SIZES = [
  { label: "desktop", width: 1360, height: 1500 },
  { label: "phone", width: 390, height: 1700 },
];
/** The same screen at desktop and phone width, light and dark; a page that scrolls sideways at 390 px fails. */
async function shotAllModes(name: string) {
  const overflow: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    // The app takes its theme from a class on <html> (next-themes, attribute "class"); flip it in place so open forms stay open.
    await page.evaluate((t) => {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(t);
      root.style.colorScheme = t;
    }, scheme);
    for (const size of SIZES) {
      await page.setViewportSize({ width: size.width, height: size.height });
      await page.waitForTimeout(250);
      const wide = await page.evaluate(
        () => document.documentElement.scrollWidth - document.documentElement.clientWidth,
      );
      if (wide > 1) overflow.push(`${scheme} ${size.label}: ${wide}px`);
      await shot(`${name}-${size.label}-${scheme}`);
    }
  }
  await page.evaluate(() => {
    document.documentElement.classList.remove("dark");
    document.documentElement.classList.add("light");
    document.documentElement.style.colorScheme = "light";
  });
  await page.setViewportSize({ width: 1360, height: 900 });
  assert(overflow.length === 0, `the page scrolls sideways: ${overflow.join(", ")}`);
}

const form = (p: Page, label: string) => p.locator(`form[aria-label="${label}"]`);
const bodyText = async (p: Page) => (await p.locator("body").innerText()).replace(/\s+/g, " ");
const MOVED = [
  "Speech to text",
  "Text to speech",
  "Bot e-mail addresses",
  "WhatsApp server",
  "Check for updates",
];

// ---------------------------------------------------------------------------------------------------------------------- account
await check("first-run account is created through the real onboarding form", async () => {
  await page.goto(`${ORIGIN}/onboarding`);
  await page.fill('[name="connection-key"]', SETUP_KEY);
  await page.click('button[type="submit"]');
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill('[name="name"]', "Places Tester");
  await page.fill('[name="email"]', "tester@example.invalid");
  await page.fill('[name="password"]', ACCOUNT_PASSWORD);
  await page.fill('[name="confirm"]', ACCOUNT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.getByLabel("Name", { exact: true }).waitFor();
});
await page.setViewportSize({ width: 1360, height: 900 });

// ---------------------------------------------------------------------------------------------------------------------- decisions
await check(
  "Studio > Decisions shows only Laya status, its switch and the sample form",
  async () => {
    await page.goto(`${ORIGIN}/studio/decisions`);
    await page.getByText("Laya").first().waitFor();
    await page.getByText("Try it on a sample").waitFor();
    const text = await bodyText(page);
    assert(text.includes("Free, local, and used by workflows"), "the Laya status line is missing");
    for (const gone of MOVED) assert(!text.includes(gone), `"${gone}" is still on Decisions`);
    const forms = await page.locator("#studio-panel form").count();
    assert(forms <= 2, `${forms} forms on Decisions`);
    await shotAllModes("01-decisions");
  },
);

await check("the Studio side nav lists Voice right after Phone numbers", async () => {
  const tabs = await page
    .getByRole("navigation", { name: "Studio sections" })
    .getByRole("link")
    .allInnerTexts();
  const names = tabs.map((t) => t.trim());
  const at = names.indexOf("Phone numbers");
  assert(at >= 0 && names[at + 1] === "Voice", `tabs: ${names.join(" | ")}`);
  await page.goto(`${ORIGIN}/studio/overview`);
  await page.getByRole("link", { name: "Overview" }).waitFor();
  assert(
    (await page.locator('#studio-panel a[href="/studio/voice"]').count()) === 0,
    "Voice must not be a card of the Overview",
  );
});

// ---------------------------------------------------------------------------------------------------------------------- voice
await check(
  "Studio > Voice loads both cards; a speech-to-text setting saves and survives a reload",
  async () => {
    await page.goto(`${ORIGIN}/studio/voice`);
    await form(page, "Speech to text").waitFor();
    await form(page, "Text to speech").waitFor();
    const stt = form(page, "Speech to text");
    await stt.locator('select[name="transcribeProvider"]').selectOption("openai");
    await stt.locator('input[name="transcribeModel"]').fill("whisper-1");
    await shotAllModes("02-voice");
    await stt.getByRole("button", { name: /^Save(: |$)/ }).click();
    await stt.getByText("Saved.").waitFor();
    await page.reload();
    await form(page, "Speech to text").waitFor();
    const after = form(page, "Speech to text");
    assert(
      (await after.locator('select[name="transcribeProvider"]').inputValue()) === "openai",
      "the provider did not survive a reload",
    );
    assert(
      (await after.locator('input[name="transcribeModel"]').inputValue()) === "whisper-1",
      "the model did not survive a reload",
    );
  },
);

// ---------------------------------------------------------------------------------------------------------------------- WhatsApp
const WAHA = "http://waha.example.invalid:3010";
await check(
  "the WhatsApp plugin page shows Server for everyone, and the address saves",
  async () => {
    await page.goto(`${ORIGIN}/plugins/whatsapp`);
    const section = page.locator('section[aria-label="Server for everyone"]');
    await section.waitFor();
    assert(
      (await section.innerText()).includes("WhatsApp server (WAHA)"),
      "the WAHA card is not in the section",
    );
    const waha = form(page, "WhatsApp server (WAHA)");
    await waha.locator('input[name="wahaUrl"]').fill(WAHA);
    await shotAllModes("03-whatsapp");
    await waha.getByRole("button", { name: "Save", exact: true }).click();
    await page.waitForFunction(() =>
      [...document.querySelectorAll('form[aria-label="WhatsApp server (WAHA)"] button')].some(
        (b) => b.textContent?.trim() === "Save" && (b as HTMLButtonElement).disabled,
      ),
    );
    await page.reload();
    await form(page, "WhatsApp server (WAHA)").waitFor();
    const saved = await form(page, "WhatsApp server (WAHA)")
      .locator('input[name="wahaUrl"]')
      .inputValue();
    assert(saved === WAHA, `the address after a reload is "${saved}"`);
  },
);

// ---------------------------------------------------------------------------------------------------------------------- Bot e-mail address
await check("the Bot e-mail address plugin page shows its server setup", async () => {
  await page.goto(`${ORIGIN}/plugins/botmail`);
  const section = page.locator('section[aria-label="Server setup"]');
  await section.waitFor();
  assert((await section.innerText()).includes("Bot e-mail addresses"), "the mail card is missing");
  assert(
    (await page.locator("body").innerText()).includes("Built in"),
    "the built-in page lost its badge",
  );
  assert(
    (await section.locator("input, select").count()) > 0,
    "the section has no field for an administrator",
  );
  await shotAllModes("04-botmail");
  const mail = form(page, "Bot e-mail addresses");
  await mail.locator('select[name="mailProvider"]').selectOption("resend");
  await mail.locator('input[name="mailDomain"]').fill("bots.example.invalid");
  await mail.getByRole("button", { name: /^Save(: |$)/ }).click();
  await page.waitForFunction(() =>
    [...document.querySelectorAll('form[aria-label="Bot e-mail addresses"] p')].some((p) =>
      /Saved\./.test(p.textContent ?? ""),
    ),
  );
  await page.reload();
  const after = form(page, "Bot e-mail addresses");
  await after.waitFor();
  assert(
    (await after.locator('input[name="mailDomain"]').inputValue()) === "bots.example.invalid",
    "the domain did not survive a reload",
  );
});

await check("the plugin list leads to both pages", async () => {
  await page.goto(`${ORIGIN}/studio/plugins`);
  const open = async (card: string, button: string, path: string) => {
    await page.getByRole("button", { name: /^All \d+$/ }).click();
    const c = page.locator("div.rounded-lg").filter({ hasText: card }).first();
    await c.getByRole("button", { name: button, exact: true }).click();
    await page.waitForURL(`**${path}`);
    await page.goto(`${ORIGIN}/studio/plugins`);
  };
  await open("Bot e-mail address", "Manage", "/plugins/botmail");
  await open("WhatsApp", "Install", "/plugins/whatsapp");
});

// ---------------------------------------------------------------------------------------------------------------------- Server settings
await check("Server settings shows the Updates card and its switch saves", async () => {
  await page.goto(`${ORIGIN}/studio/settings`);
  const card = page.locator('section[aria-label="Updates"]');
  await card.waitFor();
  const box = card.locator('input[type="checkbox"]');
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLInputElement>('section[aria-label="Updates"] input')?.disabled,
  );
  assert(await box.isChecked(), "the check should start on");
  await shotAllModes("05-server-settings");
  await box.evaluate((el: HTMLInputElement) => el.click());
  await page.waitForFunction(
    () => !document.querySelector<HTMLInputElement>('section[aria-label="Updates"] input')?.checked,
  );
  await page.reload();
  await card.waitFor();
  await page.waitForFunction(
    () =>
      !document.querySelector<HTMLInputElement>('section[aria-label="Updates"] input')?.disabled,
  );
  assert(
    !(await card.locator('input[type="checkbox"]').isChecked()),
    "off did not survive a reload",
  );
  // Put it back: the run leaves the setting as it found it.
  await card.locator('input[type="checkbox"]').evaluate((el: HTMLInputElement) => el.click());
  await page.waitForFunction(
    () =>
      !!document.querySelector<HTMLInputElement>('section[aria-label="Updates"] input')?.checked,
  );
});

// ---------------------------------------------------------------------------------------------------------------------- a member
let memberPage: Page | undefined;
await check("a second account is created through an invitation", async () => {
  await page.goto(`${ORIGIN}/studio/overview`);
  const token = await page.evaluate(async () => {
    const r = await fetch("/api/identity/invitations", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ intendedEmail: "member@example.invalid" }),
    });
    const j = (await r.json()) as { token?: string };
    return r.ok ? (j.token ?? "") : `HTTP ${r.status}`;
  });
  assert(token && !token.startsWith("HTTP"), `no invitation token: ${token}`);
  const second = await browser.newContext();
  memberPage = await second.newPage();
  wire(memberPage);
  await memberPage.goto(`${ORIGIN}/`);
  const result = await memberPage.evaluate(
    async (a) => {
      const r = await fetch("/api/auth/sign-up/email", {
        method: "POST",
        credentials: "include",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(a),
      });
      return `${r.status}`;
    },
    {
      name: "Member Tester",
      email: "member@example.invalid",
      password: ACCOUNT_PASSWORD,
      invitationToken: token,
    },
  );
  assert(result === "200", `sign-up answered ${result}`);
  const accepted = await memberPage.evaluate(async (t) => {
    const r = await fetch("/api/identity/invitations/accept", {
      method: "POST",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: t }),
    });
    return r.status;
  }, token);
  assert(accepted === 200, `accepting the invitation answered ${accepted}`);
  const status = await memberPage.evaluate(async () => {
    const r = await fetch("/api/identity/status", { credentials: "include" });
    return (await r.json()) as { state: string; isAdmin: boolean };
  });
  assert(status.state === "active" && status.isAdmin === false, JSON.stringify(status));
  // A new account sets up its own Chief first; the app marks that done with this one request, which is what the last step does.
  const marked = await memberPage.evaluate(async () => {
    const r = await fetch("/api/preferences", {
      method: "PATCH",
      credentials: "include",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ memberOnboarding: "done" }),
    });
    return r.status;
  });
  assert(marked === 200, `marking the member set-up as done answered ${marked}`);
});

await check("a member sees none of the administrator sections and no write is sent", async () => {
  assert(memberPage, "no member session");
  const m = memberPage;
  await m.setViewportSize({ width: 1360, height: 1100 });
  const writes: string[] = [];
  const reads: string[] = [];
  m.on("request", (r) => {
    const path = new URL(r.url()).pathname;
    if (r.method() !== "GET") writes.push(`${r.method()} ${path}`);
    else if (path === "/api/settings" || path.startsWith("/api/settings/")) reads.push(path);
  });
  await m.goto(`${ORIGIN}/studio/voice`);
  await m
    .getByText("Ask your administrator")
    .first()
    .waitFor()
    .catch(async (e) => {
      await m.screenshot({ path: join(SHOTS, "FAIL-member-voice.png") });
      throw new Error(`${(await bodyText(m)).slice(0, 300)} @ ${m.url()} :: ${e.message}`);
    });
  assert(
    (await m.locator("#studio-panel select, #studio-panel form").count()) === 0,
    "a member sees a Voice field",
  );
  await m.screenshot({ path: join(SHOTS, "06-member-voice.png") });
  console.log(`SHOT ${join(SHOTS, "06-member-voice.png")}`);

  await m.goto(`${ORIGIN}/plugins/whatsapp`);
  await m.getByRole("heading", { name: "WhatsApp" }).first().waitFor();
  await m.waitForTimeout(800);
  assert(
    (await m.locator('section[aria-label="Server for everyone"]').count()) === 0,
    "a member sees Server for everyone",
  );
  assert(!(await bodyText(m)).includes("WhatsApp server (WAHA)"), "a member sees the WAHA card");
  await m.screenshot({ path: join(SHOTS, "07-member-whatsapp.png") });
  console.log(`SHOT ${join(SHOTS, "07-member-whatsapp.png")}`);

  await m.goto(`${ORIGIN}/plugins/botmail`);
  await m.getByRole("heading", { name: "Bot e-mail address" }).first().waitFor();
  await m.waitForTimeout(800);
  assert(
    (await m.locator('section[aria-label="Server setup"]').count()) === 0,
    "a member sees the mail setup",
  );
  assert((await m.locator("main form, #root form").count()) === 0, "a member sees a mail form");
  await m.screenshot({ path: join(SHOTS, "08-member-botmail.png") });
  console.log(`SHOT ${join(SHOTS, "08-member-botmail.png")}`);

  await m.goto(`${ORIGIN}/studio/settings`);
  await m
    .getByText("Only administrators")
    .first()
    .waitFor()
    .catch(() => undefined);
  assert(
    (await m.locator('section[aria-label="Updates"]').count()) === 0,
    "a member sees the Updates card",
  );
  assert(reads.length === 0, `a member read the settings: ${reads.join(", ")}`);
  assert(writes.length === 0, `a member sent: ${writes.join(", ")}`);
  return "voice, WhatsApp, Bot e-mail address and Server settings checked";
});

await browser.close();
console.log("DONE");
