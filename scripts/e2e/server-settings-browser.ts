// The browser half of server-settings.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/server-settings.ts`.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("SETTINGS_E2E_ORIGIN");
const SHOTS = env("SETTINGS_E2E_SHOTS");
const CDP = env("SETTINGS_E2E_CDP");
const ACCOUNT_PASSWORD = env("SETTINGS_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("SETTINGS_E2E_SETUP_KEY");
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(
  env("SETTINGS_E2E_PLAYWRIGHT")
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

const row = (label: string) => page.locator(`form[aria-label="${label}"]`);
const open = async (search = "") => {
  await page.goto(`${ORIGIN}/studio/settings${search}`);
  await page.getByRole("heading", { name: "Bot runs", exact: false }).first().waitFor();
};
/** A switch is a checkbox the library draws; a click on the input itself is what a person's click does. */
const toggle = (label: string, key: string) =>
  row(label)
    .locator(`input[name="${key}"]`)
    .evaluate((el: HTMLInputElement) => el.click());
const save = (label: string) =>
  row(label).getByRole("button", { name: "Save", exact: true }).click();
const rowText = async (label: string) => (await row(label).innerText()).replace(/\s+/g, " ");
const urlQuery = () => new URL(page.url()).search;

const LIVE = "Messages reach Claude Code while it works";
const LIGHT = "Light background runs";
const RUNS = "Bot runs at once, in total";
const NET = "Let the server call private network addresses";

// ---------------------------------------------------------------------------------------------------------------------- account
await check("first-run account is created through the real onboarding form", async () => {
  await page.goto(`${ORIGIN}/onboarding`);
  await page.fill('[name="connection-key"]', SETUP_KEY);
  await page.click('button[type="submit"]');
  await page.getByRole("button", { name: "Continue" }).click();
  await page.fill('[name="name"]', "Settings Tester");
  await page.fill('[name="email"]', "tester@example.invalid");
  await page.fill('[name="password"]', ACCOUNT_PASSWORD);
  await page.fill('[name="confirm"]', ACCOUNT_PASSWORD);
  await page.click('button[type="submit"]');
  await page.getByLabel("Name", { exact: true }).waitFor();
});
await page.setViewportSize({ width: 1360, height: 900 });

// ---------------------------------------------------------------------------------------------------------------------- the list
await check(
  "the tab is in the Studio side nav for the administrator and the page groups the keys with their sources",
  async () => {
    await page.goto(`${ORIGIN}/studio/overview`);
    await page.getByRole("tab", { name: "Server settings" }).click();
    await page.waitForURL(/\/studio\/settings/);
    await page.getByRole("heading", { name: "Bot runs", exact: false }).first().waitFor();
    const groups = await page.locator("main h3, #studio-panel h3").allInnerTexts();
    for (const g of ["Bot runs", "Memory and learning", "Limits and quotas", "Security policy"])
      assert(groups.includes(g), `group "${g}" is missing: ${groups.join(" | ")}`);
    assert(
      (await page.locator("#studio-panel").innerText()).includes(
        "These apply to the whole installation.",
      ),
      "the header sentence about the whole installation is missing",
    );
    assert(
      (await rowText(RUNS)).includes("Now: 8 runs. The default."),
      `default source not shown: ${await rowText(RUNS)}`,
    );
    await shot("01-list");
    return `${groups.length} groups`;
  },
);

await check("a value imported from the environment says so", async () => {
  const t = await rowText(LIGHT);
  assert(t.includes("Now: On."), t);
  assert(t.includes("Imported from the environment"), t);
  assert(t.includes("the default is Off"), t);
});

await check("a security policy carries its warning", async () => {
  const t = await rowText(NET);
  assert(t.includes("Security policy: changes apply at once to everyone."), t);
});

// ---------------------------------------------------------------------------------------------------------------------- saving
await check("a switch saved off persists after a reload with source 'installation'", async () => {
  await toggle(LIVE, "claudeLiveInput");
  await shot("02-switch-changed");
  await save(LIVE);
  await row(LIVE).getByText("Saved.").waitFor();
  await page.reload();
  await row(LIVE).waitFor();
  const t = await rowText(LIVE);
  assert(t.includes("Now: Off.") && t.includes("Set for the installation"), t);
  await shot("03-switch-saved");
});

await check("a number saved persists after a reload with source 'installation'", async () => {
  await row(RUNS).locator('input[name="harnessMax"]').fill("3");
  await save(RUNS);
  await row(RUNS).getByText("Saved.").waitFor();
  await page.reload();
  await row(RUNS).waitFor();
  const t = await rowText(RUNS);
  assert(t.includes("Now: 3 runs.") && t.includes("Set for the installation"), t);
  assert(
    (await row(RUNS).locator('input[name="harnessMax"]').inputValue()) === "3",
    "the field kept 3",
  );
});

await check("reset to default puts a switch back and the page says 'The default'", async () => {
  await row(LIVE).getByRole("button", { name: "Reset to default" }).click();
  await row(LIVE).getByText("Back to the default.").waitFor();
  await page.reload();
  await row(LIVE).waitFor();
  const t = await rowText(LIVE);
  assert(t.includes("Now: On.") && t.includes("The default"), t);
  assert(
    (await row(LIVE).getByRole("button", { name: "Reset to default" }).count()) === 0,
    "reset is still offered at the default",
  );
  await shot("04-reset");
});

await check(
  "a security policy asks first; Cancel changes nothing; confirming saves it",
  async () => {
    await toggle(NET, "allowPrivateNetwork");
    await save(NET);
    await page.getByText(/applies at once to everyone on this server\. Save it\?/).waitFor();
    await shot("05-sensitive-confirm");
    await page.getByRole("button", { name: "Cancel" }).click();
    await page.reload();
    assert((await rowText(NET)).includes("The default"), "Cancel must save nothing");
    await toggle(NET, "allowPrivateNetwork");
    await save(NET);
    await page.getByRole("button", { name: "Save for everyone" }).click();
    await row(NET).getByText("Saved.").waitFor();
    await page.reload();
    assert((await rowText(NET)).includes("Set for the installation"), await rowText(NET));
    // Put it back: the run leaves the policy as it found it.
    await row(NET).getByRole("button", { name: "Reset to default" }).click();
    await row(NET).getByText("Back to the default.").waitFor();
  },
);

await check("the server's validation error is shown next to the field", async () => {
  await row(RUNS).locator('input[name="harnessMax"]').fill("99999");
  await save(RUNS);
  // The library's own field has an (empty) alert slot too: the page's sentence is the one that has text.
  const alert = row(RUNS).locator('p[role="alert"]').filter({ hasText: /\S/ });
  await alert.waitFor();
  const said = (await alert.innerText()).trim();
  assert(said.length > 5, `no sentence: "${said}"`);
  assert(
    (await row(RUNS).locator('input[name="harnessMax"]').inputValue()) === "99999",
    "the typed value must stay",
  );
  await shot("06-validation-error");
  return said;
});

// ---------------------------------------------------------------------------------------------------------------------- filters
await check("the group filter writes the address and survives a reload", async () => {
  await open();
  await page.locator('select[name="group"]').selectOption("limits");
  await page.waitForURL(/group=limits/);
  assert(urlQuery() === "?group=limits", `address ${urlQuery()}`);
  const labels = await page.locator("form h4").allInnerTexts();
  assert(labels.length > 0 && labels.includes(RUNS) && !labels.includes(LIVE), labels.join(" | "));
  await page.reload();
  await page.locator('select[name="group"]').waitFor();
  assert(
    (await page.locator('select[name="group"]').inputValue()) === "limits",
    "group after reload",
  );
  assert((await page.locator("form h4").allInnerTexts()).length === labels.length, "same rows");
  await shot("07-group-filter");
});

await check(
  "'Only changed' writes the address and survives a reload; defaults are left out",
  async () => {
    await open();
    await page.locator('select[name="show"]').selectOption("changed");
    await page.waitForURL(/show=changed/);
    assert(urlQuery() === "?show=changed", `address ${urlQuery()}`);
    const shown = async () => page.locator("form h4").allInnerTexts();
    const first = await shown();
    // Changed now: the imported Light runs and the saved number that kept 3 (the 99999 was never saved).
    assert(first.includes(LIGHT) && first.includes(RUNS), first.join(" | "));
    assert(!first.includes(LIVE), "a key at its default must be hidden");
    await page.reload();
    await page.locator('select[name="show"]').waitFor();
    assert(
      (await page.locator('select[name="show"]').inputValue()) === "changed",
      "show after reload",
    );
    assert((await shown()).length === first.length, "same rows after reload");
    await shot("08-only-changed");
    await page.locator('select[name="show"]').selectOption("all");
    await page.waitForFunction(() => !location.search.includes("show"));
    assert(urlQuery() === "", `all must leave the address empty, got ${urlQuery()}`);
  },
);

await check("the search text is in the address and filters the page", async () => {
  await open();
  await page.locator('input[name="q"]').fill("background");
  await page.waitForURL(/q=background/);
  const labels = await page.locator("form h4").allInnerTexts();
  assert(labels.includes(LIGHT) && labels.length < 5, labels.join(" | "));
  await page.locator('input[name="q"]').fill("zzzzzz");
  await page.getByText("No setting matches.").waitFor();
  await shot("09-nothing-matches");
});

await browser.close();
console.log("DONE");
