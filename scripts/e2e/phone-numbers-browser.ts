// The browser half of phone-numbers.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/phone-numbers.ts`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("PHONE_E2E_ORIGIN");
const SHOTS = env("PHONE_E2E_SHOTS");
const CDP = env("PHONE_E2E_CDP");
const ACCOUNT_PASSWORD = env("PHONE_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("PHONE_E2E_SETUP_KEY");
const TELNYX_KEY = env("PHONE_E2E_TELNYX_KEY");
const TELNYX_PUBLIC_KEY = env("PHONE_E2E_TELNYX_PUBLIC_KEY");
const TELNYX_APPLICATION = env("PHONE_E2E_TELNYX_APPLICATION");
const TWILIO_SID = env("PHONE_E2E_TWILIO_SID");
const TWILIO_TOKEN = env("PHONE_E2E_TWILIO_TOKEN");
const OWNED_TELNYX = env("PHONE_E2E_OWNED_TELNYX");
const OWNED_TWILIO = env("PHONE_E2E_OWNED_TWILIO");
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(
  env("PHONE_E2E_PLAYWRIGHT")
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

const shotNames: string[] = [];
async function shot(name: string) {
  const file = join(SHOTS, `${name.replace(/[^\w.-]+/g, "-")}.png`);
  await page.screenshot({ path: file });
  shotNames.push(file);
  console.log(`SHOT ${file}`);
}

const dialogs: string[] = [];
let crashed = false;
function wire(p: Page) {
  p.setDefaultTimeout(30_000);
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

const bots: Record<string, string> = {};
/** The bots the person owns, created through the API with the same session as the page (the fixture engine needs no login). */
async function createBot(name: string) {
  const res = await page.context().request.post(`${ORIGIN}/api/bots`, {
    headers: { origin: ORIGIN, "content-type": "application/json" },
    data: { name, harness: "fixture" },
  });
  assert(res.ok(), `creating ${name}: ${res.status()} ${await res.text()}`);
  bots[name] = ((await res.json()) as { bot: { id: string } }).bot.id;
}
const chiefId = async () => {
  const res = await page.context().request.get(`${ORIGIN}/api/bots`);
  const list = ((await res.json()) as { bots: { id: string; kind: string }[] }).bots;
  return list.find((b) => b.kind === "chief")!.id;
};
const rows = () => page.locator("table tbody tr:has(td)");
/** Choose a bot in a BotSelect: open the picker that sits next to the hidden field `name`, then press the option. */
async function pickBot(name: string, bot: string, root = page.locator("body")) {
  const box = root
    .locator(`input[name="${name}"]`)
    .locator("xpath=..")
    .locator('[role="combobox"]');
  await box.click();
  // Typing narrows the list, so the bot is in view whatever the length of the list.
  await page.keyboard.type(bot);
  await page
    .getByRole("option", { name: new RegExp(bot) })
    .first()
    .click();
}

// ---------------------------------------------------------------------------------------------------------------------- account
await check("first-run account is created through the real onboarding form", async () => {
  await page.goto(`${ORIGIN}/onboarding`);
  await page.fill('[name="connection-key"]', SETUP_KEY);
  await page.click('button[type="submit"]');
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill('[name="name"]', "Phone Tester");
  await page.fill('[name="email"]', "tester@example.invalid");
  await page.fill('[name="password"]', ACCOUNT_PASSWORD);
  await page.fill('[name="confirm"]', ACCOUNT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.getByLabel("Name", { exact: true }).waitFor();
});
await page.setViewportSize({ width: 1360, height: 820 });

await check("the bots of the run exist (Zetta, and four more through the API)", async () => {
  bots.Zetta = await chiefId();
  for (const name of ["Spare", "Scout", "Extra", "Free"]) await createBot(name);
  return Object.keys(bots).join(", ");
});

// ---------------------------------------------------------------------------------------------------------------------- setup on the page
const card = (name: "Telnyx" | "Twilio") => page.locator(`section[aria-label="${name}"]`);
const chip = (name: "Telnyx" | "Twilio") => card(name).locator("[data-status].inline-flex");
const ADDRESS = "https://zetta.example.invalid";
/** The same screen at desktop and phone width, light and dark; a page that scrolls sideways at 390 px fails. */
async function shotAllModes(name: string) {
  const sizes = [
    { label: "desktop", width: 1360, height: 900 },
    { label: "phone", width: 390, height: 844 },
  ];
  const overflow: string[] = [];
  for (const scheme of ["light", "dark"] as const) {
    // The app takes its theme from a class on <html> (next-themes, attribute "class"); flip it in place so open forms stay open.
    await page.evaluate((t) => {
      const root = document.documentElement;
      root.classList.remove("light", "dark");
      root.classList.add(t);
      root.style.colorScheme = t;
    }, scheme);
    for (const size of sizes) {
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
    document.documentElement.classList.remove("light");
    document.documentElement.classList.add("dark");
    document.documentElement.style.colorScheme = "dark";
  });
  await page.setViewportSize({ width: 1360, height: 820 });
  assert(overflow.length === 0, `the page scrolls sideways: ${overflow.join(", ")}`);
}

await check(
  "Phone numbers page: before any setup the two provider cards are the way in",
  async () => {
    await page.goto(`${ORIGIN}/studio/phone`);
    await card("Telnyx").waitFor();
    assert((await chip("Telnyx").textContent())?.includes("Not connected"), "Telnyx chip");
    assert((await chip("Twilio").textContent())?.includes("Not connected"), "Twilio chip");
    assert(
      (await card("Telnyx").locator("img[data-provider-logo]").count()) === 1 &&
        (await card("Twilio").locator("img[data-provider-logo]").count()) === 1,
      "a logo is missing",
    );
    await page.getByText("Connect a provider to choose who can ask").waitFor();
    await page.getByText("Once a provider is connected above").waitFor();
    assert(
      (await page.locator('a[href="/studio/decisions"]').count()) === 0,
      "a link to Decisions is still here",
    );
    await shotAllModes("01-nothing-connected");
  },
);

await check("Studio > Decisions no longer holds a phone card", async () => {
  await page.goto(`${ORIGIN}/studio/decisions`);
  await page.getByText("Laya").first().waitFor();
  assert(
    (await page.locator('form[aria-label="Phone numbers"]').count()) === 0 &&
      (await page.locator('select[name="phoneProvider"]').count()) === 0,
    "the phone card is still on Decisions",
  );
});

const sent: string[] = [];
await check(
  "Connect Telnyx in its card: the key is sealed in the browser and never shown again",
  async () => {
    await page.goto(`${ORIGIN}/studio/phone`);
    await card("Telnyx").waitFor();
    page.on("request", (r) => {
      if (r.method() !== "GET") sent.push(`${r.url()} ${r.postData() ?? ""}`);
    });
    await card("Telnyx").getByRole("button", { name: "Connect", exact: true }).click();
    // Refused on the page, next to the field, before anything is sent.
    await card("Telnyx").getByRole("button", { name: "Save and connect" }).click();
    await card("Telnyx").getByText("Paste the Telnyx API key.").waitFor();
    await card("Telnyx").locator('input[name="phoneKey"]').fill(TELNYX_KEY);
    await card("Telnyx").locator('input[name="phonePublicKey"]').fill(TELNYX_PUBLIC_KEY);
    await card("Telnyx").locator('input[name="phoneApplicationId"]').fill(TELNYX_APPLICATION);
    await card("Telnyx").locator('input[name="phonePublicUrl"]').fill(ADDRESS);
    await shotAllModes("02-telnyx-form");
    await card("Telnyx").getByRole("button", { name: "Save and connect" }).click();
    await chip("Telnyx")
      .filter({ hasText: /^Connected$/ })
      .waitFor();
    const leaked = sent.filter((x) => x.includes(TELNYX_KEY));
    assert(leaked.length === 0, `a plain key was sent: ${leaked.join(" | ").slice(0, 200)}`);
    assert(
      sent.some((x) => x.includes("/api/connections/phone-key")),
      "no request to phone-key",
    );
    assert(!(await page.content()).includes(TELNYX_KEY), "the key is in the page");
    // The card folded to a summary, and the part below appeared.
    assert(
      (await card("Telnyx").locator('input[name="phoneKey"]').count()) === 0,
      "the form did not fold",
    );
    await page.getByRole("heading", { name: "How people get numbers" }).waitFor();
  },
);

await check(
  "Connect Twilio in its card: the address is already there, the token is sealed",
  async () => {
    await card("Twilio").getByRole("button", { name: "Connect", exact: true }).click();
    assert(
      (await card("Twilio").locator('input[name="phonePublicUrl"]').inputValue()) === ADDRESS,
      "the shared address is not in the Twilio card",
    );
    await card("Twilio").locator('input[name="phoneTwilioAccountSid"]').fill("ACnope");
    await card("Twilio").locator('input[name="phoneTwilioKey"]').fill(TWILIO_TOKEN);
    await card("Twilio").getByRole("button", { name: "Save and connect" }).click();
    await card("Twilio")
      .getByText(/Account SID starts with AC/)
      .waitFor();
    await card("Twilio").locator('input[name="phoneTwilioAccountSid"]').fill(TWILIO_SID);
    await card("Twilio").getByRole("button", { name: "Save and connect" }).click();
    await chip("Twilio")
      .filter({ hasText: /^Connected$/ })
      .waitFor();
    const leaked = sent.filter((x) => x.includes(TWILIO_TOKEN));
    assert(leaked.length === 0, `a plain token was sent: ${leaked.join(" | ").slice(0, 200)}`);
    assert(
      sent.some((x) => x.includes("/api/connections/phone-twilio-key")),
      "no request to phone-twilio-key",
    );
    assert(!(await page.content()).includes(TWILIO_TOKEN), "the token is in the page");
    await page.reload();
    await card("Twilio").waitFor();
    assert(
      (await chip("Telnyx").textContent())?.includes("Connected") &&
        (await chip("Twilio").textContent())?.includes("Connected"),
      "not both connected after a reload",
    );
    await shotAllModes("03-both-connected");
  },
);

await check("Test per provider shows the server's sentence in its own card", async () => {
  const sentences: string[] = [];
  for (const name of ["Telnyx", "Twilio"] as const) {
    await card(name).getByRole("button", { name: "Test", exact: true }).click();
    const result = card(name)
      .locator('[role="status"], [role="alert"]')
      .filter({ hasText: /\w{4}/ });
    await result.first().waitFor();
    sentences.push(`${name}: ${(await result.first().textContent())?.trim()}`);
  }
  await shotAllModes("04-after-tests");
  return sentences.join(" | ");
});

await check(
  "The public address is one value: editing it in one card shows it in the other",
  async () => {
    await card("Telnyx").getByRole("button", { name: "Edit", exact: true }).click();
    await card("Twilio").getByRole("button", { name: "Edit", exact: true }).click();
    const a = card("Telnyx").locator('input[name="phonePublicUrl"]');
    const b = card("Twilio").locator('input[name="phonePublicUrl"]');
    assert((await a.inputValue()) === ADDRESS && (await b.inputValue()) === ADDRESS, "not shared");
    await a.fill("https://one.example.invalid");
    assert((await b.inputValue()) === "https://one.example.invalid", "Twilio did not follow");
    await b.fill("https://two.example.invalid");
    assert((await a.inputValue()) === "https://two.example.invalid", "Telnyx did not follow");
    // Unsaved, so the Test waits.
    assert(
      await card("Twilio").getByRole("button", { name: "Test", exact: true }).isDisabled(),
      "Test is not waiting for Save",
    );
    await shotAllModes("05-both-open-shared-address");
    // Saved from one card, read from the other after a reload.
    await b.fill("https://zetta2.example.invalid");
    await card("Twilio").getByRole("button", { name: "Save", exact: true }).click();
    await card("Twilio").getByRole("button", { name: "Edit", exact: true }).waitFor();
    await page.reload();
    await card("Telnyx").getByRole("button", { name: "Edit", exact: true }).click();
    assert(
      (await card("Telnyx").locator('input[name="phonePublicUrl"]').inputValue()) ===
        "https://zetta2.example.invalid",
      "Telnyx did not read the address saved from Twilio",
    );
    await card("Telnyx").locator('input[name="phonePublicUrl"]').fill(ADDRESS);
    await card("Telnyx").getByRole("button", { name: "Save", exact: true }).click();
    await card("Telnyx").getByRole("button", { name: "Edit", exact: true }).waitFor();
  },
);

await check("How people get numbers: who can ask, countries, default provider", async () => {
  const area = page.locator('section[aria-label="How people get numbers"]');
  await area.getByRole("radio", { name: /Owners ask/ }).click();
  await area.locator('select[name="phoneCountryPicker"]').selectOption("US");
  await area.locator('select[name="phoneDefaultProvider"]').selectOption("twilio");
  await area.getByRole("button", { name: "Save", exact: true }).click();
  await area.getByText("Saved.").waitFor();
  await page.reload();
  const again = page.locator('section[aria-label="How people get numbers"]');
  assert(
    (await again.getByRole("radio", { name: /Owners ask/ }).getAttribute("aria-checked")) ===
      "true",
    "who can ask was not kept",
  );
  assert(
    (await again.locator('ul[aria-label="Countries"]').textContent())?.includes("United States"),
    "country",
  );
  assert(
    (await again.locator('select[name="phoneDefaultProvider"]').inputValue()) === "twilio",
    "default provider",
  );
  await shotAllModes("06-access");
});

await check("Advanced: the limits are folded, checked and kept", async () => {
  const details = page.locator("details", { has: page.locator('form[aria-label="Limits"]') });
  assert((await details.getAttribute("open")) === null, "Advanced starts open");
  await details.locator("summary").click();
  const form = details.locator('form[aria-label="Limits"]');
  await form.locator('input[name="phoneMaxNumbers"]').fill("many");
  await form.getByRole("button", { name: "Save limits" }).click();
  await form.getByText(/whole number/).waitFor();
  await form.locator('input[name="phoneMaxNumbers"]').fill("7");
  await form.getByRole("button", { name: "Save limits" }).click();
  await form.getByText("Saved.").waitFor();
  await page.reload();
  await page.locator("details summary").filter({ hasText: "Advanced" }).click();
  assert(
    (await page.locator('input[name="phoneMaxNumbers"]').inputValue()) === "7",
    "the limit was not kept",
  );
  await shotAllModes("07-advanced-open");
});

await check("Disconnect asks first; Keep it changes nothing", async () => {
  await card("Telnyx").getByRole("button", { name: "Edit", exact: true }).click();
  await card("Telnyx").getByRole("button", { name: "Disconnect", exact: true }).click();
  await card("Telnyx").getByText("Disconnect Telnyx?").waitFor();
  await shot("08-disconnect-asks");
  await card("Telnyx").getByRole("button", { name: "Keep it" }).click();
  assert((await chip("Telnyx").textContent())?.includes("Connected"), "Telnyx changed");
  await card("Telnyx").getByRole("button", { name: "Close", exact: true }).click();
});

// ---------------------------------------------------------------------------------------------------------------------- request
async function requestFor(bot: string, provider: "telnyx" | "twilio" | "default") {
  await page.goto(`${ORIGIN}/bots/${bots[bot]}/settings`);
  const form = page.locator('form[aria-label="Give this bot a phone number"]');
  await form.waitFor();
  const select = form.locator('select[name="phoneProvider"]');
  await select.waitFor();
  const preselected = await select.inputValue();
  if (provider !== "default") await select.selectOption(provider);
  await form.getByRole("button", { name: /Give this bot a phone number/ }).click();
  await page.getByText(/Provider: (Telnyx|Twilio)/).waitFor();
  return {
    preselected,
    shown: (
      await page
        .getByText(/Provider: (Telnyx|Twilio)/)
        .first()
        .textContent()
    )?.trim(),
  };
}
await check(
  "Request as a person: two ready providers show a choice, the default (Twilio) preselected; choosing Telnyx buys it there",
  async () => {
    const r = await requestFor("Spare", "telnyx");
    assert(r.preselected === "twilio", `default preselected was ${r.preselected}`);
    assert(r.shown === "Provider: Telnyx", `shown ${r.shown}`);
    await shot("04-request-telnyx-done");
    return r.shown;
  },
);
await check("Request as a person: leaving the default buys the number at Twilio", async () => {
  const r = await requestFor("Scout", "default");
  assert(r.shown === "Provider: Twilio", `shown ${r.shown}`);
  return r.shown;
});

// ---------------------------------------------------------------------------------------------------------------------- Numbers page
await check("Numbers page: every number with provider, bot and owner", async () => {
  await page.goto(`${ORIGIN}/studio/phone`);
  await rows().first().waitFor();
  assert((await rows().count()) === 2, `rows: ${await rows().count()}`);
  const text = (await rows().allTextContents()).join(" || ");
  assert(/Telnyx/.test(text) && /Twilio/.test(text), text);
  assert(/Spare/.test(text) && /Scout/.test(text) && /Phone Tester/.test(text), text);
  await shot("05-numbers-page");
  return text.slice(0, 300);
});

await check(
  "Attach a number I own: Telnyx number to Zetta (the provider chosen), shown in the table",
  async () => {
    const form = page.locator('form[aria-label="Attach a number I own"]');
    await form.locator('input[name="attachNumber"]').fill(OWNED_TELNYX);
    await form.locator('select[name="attachProvider"]').selectOption("telnyx");
    await pickBot("attachBot", "Zetta", form);
    await form.getByRole("button", { name: "Attach the number" }).click();
    await page.getByText("The number is attached.").waitFor();
    await page.waitForFunction(() => document.querySelectorAll("table tbody tr").length >= 3);
    const zetta = rows().filter({ hasText: "Zetta" });
    assert((await zetta.count()) === 1, "no Zetta row");
    assert(/Telnyx/.test((await zetta.textContent()) ?? ""), "the Zetta row is not Telnyx");
    await shot("06-attached-to-zetta");
  },
);
await check("Attach a number I own: Twilio number to another bot", async () => {
  const form = page.locator('form[aria-label="Attach a number I own"]');
  await form.locator('input[name="attachNumber"]').fill(OWNED_TWILIO);
  await form.locator('select[name="attachProvider"]').selectOption("twilio");
  await pickBot("attachBot", "Extra", form);
  await form.getByRole("button", { name: "Attach the number" }).click();
  await page.waitForFunction(() => document.querySelectorAll("table tbody tr").length >= 4);
  assert((await rows().filter({ hasText: "Extra" }).count()) === 1, "no Extra row");
});
await check(
  "Attach refusals read as the server's sentence: a number the account does not hold, and a bot that has one",
  async () => {
    const form = page.locator('form[aria-label="Attach a number I own"]');
    await form.locator('input[name="attachNumber"]').fill("+12025550199");
    await pickBot("attachBot", "Free", form);
    await form.getByRole("button", { name: "Attach the number" }).click();
    const first = await page.getByRole("alert").filter({ hasText: /\w{4}/ }).first().textContent();
    await shot("07-attach-refused-not-on-account");
    await form.locator('input[name="attachNumber"]').fill(OWNED_TELNYX);
    await pickBot("attachBot", "Spare", form);
    await form.getByRole("button", { name: "Attach the number" }).click();
    await page.waitForTimeout(800);
    const second = await page.getByRole("alert").filter({ hasText: /\w{4}/ }).first().textContent();
    assert(first && second && first !== second, `first: ${first} | second: ${second}`);
    return `${first?.trim()} | ${second?.trim()}`;
  },
);

await check(
  "Reassign: Zetta's number moves to the free bot, and Zetta shows no number",
  async () => {
    await page.reload();
    await rows().first().waitFor();
    const row = rows().filter({ hasText: "Zetta" });
    await row.getByRole("button", { name: "Reassign" }).click();
    const form = page.locator('form[aria-label^="Reassign"]');
    await form.locator('[role="combobox"]').click();
    await page.keyboard.type("Free");
    await page.getByRole("option", { name: /Free/ }).first().click();
    await shot("08-reassign-picker");
    await form.getByRole("button", { name: "Move the number" }).click();
    await page.getByText("The number was moved.").waitFor();
    assert((await rows().filter({ hasText: "Free" }).count()) === 1, "Free has no number");
    assert((await rows().filter({ hasText: "Zetta" }).count()) === 0, "Zetta still has a row");
    await shot("09-after-reassign");
  },
);

await check(
  "Filters live in the address: provider and status change the URL, a reload keeps them",
  async () => {
    await page.goto(`${ORIGIN}/studio/phone`);
    await rows().first().waitFor();
    const all = await rows().count();
    await page.locator('select[name="provider"]').selectOption("twilio");
    await page.waitForURL(/provider=twilio/);
    const twilioRows = await rows().count();
    assert(twilioRows < all && twilioRows >= 1, `all ${all}, twilio ${twilioRows}`);
    assert(
      !(await rows().allTextContents()).some((t) => /Telnyx/.test(t)),
      "a Telnyx row under the Twilio filter",
    );
    await page.locator('select[name="status"]').selectOption("active");
    await page.waitForURL(/status=active/);
    await page.locator('input[name="q"]').fill("Extra");
    await page.waitForURL(/q=Extra/);
    const url = page.url();
    assert(/provider=twilio/.test(url) && /status=active/.test(url) && /q=Extra/.test(url), url);
    assert((await rows().count()) === 1, `rows with Extra: ${await rows().count()}`);
    await shot("10-filters");
    await page.reload();
    await rows().first().waitFor();
    assert(page.url() === url, `the address changed on reload: ${page.url()}`);
    assert(
      (await page.locator('select[name="provider"]').inputValue()) === "twilio",
      "provider select lost",
    );
    assert((await page.locator('input[name="q"]').inputValue()) === "Extra", "text lost");
    assert((await rows().count()) === 1, "reload changed the rows");
    await page.goBack();
    return url;
  },
);

await check("Release asks first; Release now frees the number", async () => {
  await page.goto(`${ORIGIN}/studio/phone`);
  await rows().first().waitFor();
  const before = await rows().count();
  await rows().filter({ hasText: "Scout" }).getByRole("button", { name: "Release" }).click();
  await page.getByText(/now\? The provider takes it back/).waitFor();
  await shot("11-release-confirm");
  await page.getByRole("button", { name: "Release now" }).click();
  await page.waitForFunction(
    (n) => document.querySelectorAll("table tbody tr:has(td)").length < n,
    before,
  );
});

await check("The tab is in the Studio side nav for an administrator", async () => {
  await page.goto(`${ORIGIN}/studio/phone`);
  await page.getByRole("tab", { name: "Phone numbers" }).waitFor();
});

await browser.close();
console.log("DONE");
