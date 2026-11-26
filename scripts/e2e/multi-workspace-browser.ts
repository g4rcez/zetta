// The browser half of multi-workspace.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/multi-workspace.ts`.
//
// Three people, each in a browser context of their own: Rita sets the server up (root), Ana owns a workspace Rita starts for another
// organization, Bo is in both.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("WORKSPACES_E2E_ORIGIN");
const SHOTS = env("WORKSPACES_E2E_SHOTS");
const CDP = env("WORKSPACES_E2E_CDP");
const ACCOUNT_PASSWORD = env("WORKSPACES_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("WORKSPACES_E2E_SETUP_KEY");
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(
  env("WORKSPACES_E2E_PLAYWRIGHT")
)) as typeof import("playwright-core");

const out = (name: string, result: "pass" | "fail" | "skip", detail = "") =>
  console.log(`RESULT ${JSON.stringify({ name, result, detail })}`);
const assert = (ok: unknown, what: string) => {
  if (!ok) throw new Error(what);
};

const browser = await chromium.connectOverCDP(CDP);
const context = browser.contexts()[0]!;
// The first tab, after a pause: a tab opened at once has its first navigation aborted.
await new Promise((r) => setTimeout(r, 3000));

function wire(p: Page, who: string) {
  p.setDefaultTimeout(30_000);
  p.on("pageerror", (e) => console.log(`[${who} page error] ${e.message.slice(0, 300)}`));
  p.on("dialog", (d) => void d.dismiss());
  return p;
}
const rita = wire(context.pages()[0] ?? (await context.newPage()), "rita");
await rita.setViewportSize({ width: 1360, height: 900 });
const newPerson = async (who: string) =>
  wire(await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage(), who);

async function shot(page: Page, name: string) {
  const file = join(SHOTS, `${name.replace(/[^\w.-]+/g, "-")}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(`SHOT ${file}`);
}
async function check(name: string, page: Page, run: () => Promise<string | void>) {
  try {
    out(name, "pass", (await run()) || "");
  } catch (e) {
    out(name, "fail", e instanceof Error ? e.message : String(e));
    await shot(page, `FAIL-${name}`).catch(() => undefined);
  }
}

/** A call from the page as the app makes it: through its own `fetch`, which says which workspace the tab works in. */
const api = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, p, b]) => {
      const response = await fetch(p as string, {
        method: m as string,
        credentials: "include",
        headers: b ? { "content-type": "application/json" } : undefined,
        body: b ? JSON.stringify(b) : undefined,
      });
      const text = await response.text();
      return { status: response.status, body: JSON.parse(text || "null") };
    },
    [method, path, body ?? null] as const,
  );
type Entry = { id: string; slug: string; name: string; role: string; current: boolean };
const mine = async (page: Page) =>
  (await api(page, "GET", "/api/workspace/all")).body as {
    workspaces: Entry[];
    mayCreate: boolean;
  };
/** The workspace menu at the top of the sidebar, by the workspace it shows. */
const switcher = (page: Page, name: string) =>
  page.locator('aside[aria-label="Sidebar"] button').filter({ hasText: name }).first();
const botIds = async (page: Page) =>
  ((await api(page, "GET", "/api/bots")).body.bots as { id: string; kind: string }[]).map(
    (b) => b.id,
  );

async function signUp(page: Page, name: string, email: string, token: string) {
  await page.goto(`${ORIGIN}/login`);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.fill("#signup-name", name);
  await page.fill("#signup-email", email);
  await page.fill("#signup-password", ACCOUNT_PASSWORD);
  await page.fill("#signup-invitation", token);
  await page.getByRole("button", { name: "Create account with invitation" }).click();
  for (let i = 0; i < 40; i++) {
    const state = await page
      .evaluate(
        async () =>
          (await (await fetch("/api/identity/status", { credentials: "include" })).json()).state,
      )
      .catch(() => null);
    if (state === "active") {
      // Past the first-run setup of their own Chief, as the app does when they finish it: this check is about workspaces.
      await page.evaluate(() =>
        fetch("/api/preferences", {
          method: "PATCH",
          credentials: "include",
          headers: { "content-type": "application/json" },
          body: JSON.stringify({ memberOnboarding: "done" }),
        }),
      );
      return;
    }
    await page.waitForTimeout(500);
  }
  throw new Error(`${name} did not become active`);
}

/** Sends an invitation from the People page of the workspace the tab works in, and reads its token. */
async function invite(page: Page, email: string) {
  const w = new URL(page.url()).searchParams.get("w");
  await page.goto(`${ORIGIN}/studio/invites${w ? `?w=${w}` : ""}`);
  await page.getByRole("heading", { name: "Invite a member" }).waitFor();
  await page.fill("#invited-email", email);
  await page.getByRole("button", { name: "Create invitation" }).click();
  await page.locator("#issued-token").waitFor();
  return page.locator("#issued-token").inputValue();
}

// ------------------------------------------------------------------------------------------------------------------------- root
await check("the first account sets the server up and owns the first workspace", rita, async () => {
  await rita.goto(`${ORIGIN}/onboarding`);
  await rita.fill('[name="connection-key"]', SETUP_KEY);
  await rita.click('button[type="submit"]');
  await rita.getByRole("button", { name: "Continue" }).click();
  await rita.fill('[name="name"]', "Rita Root");
  await rita.fill('[name="email"]', "rita@example.invalid");
  await rita.fill('[name="password"]', ACCOUNT_PASSWORD);
  await rita.fill('[name="confirm"]', ACCOUNT_PASSWORD);
  await rita.click('button[type="submit"]');
  await rita.getByLabel("Name", { exact: true }).waitFor();
  const all = await mine(rita);
  assert(all.workspaces.length === 1 && all.workspaces[0]!.role === "owner", JSON.stringify(all));
  assert(all.mayCreate, "root may not start a workspace");
});

let acmeToken = "";
await check(
  "root starts a workspace for another organization and gets its owner's code once",
  rita,
  async () => {
    await rita.goto(`${ORIGIN}/studio/invites`);
    const start = rita.locator("#start-workspace");
    await start.waitFor();
    await start.locator('[name="name"]').fill("Acme Co");
    assert(
      (await start.locator('[name="slug"]').inputValue()) === "acme-co",
      "the address name is not made from the name",
    );
    await start.locator('[name="ownerEmail"]').fill("ana@example.invalid");
    await start.getByRole("button", { name: "Start workspace" }).click();
    await rita.locator("#started-workspace-token").waitFor();
    acmeToken = await rita.locator("#started-workspace-token").inputValue();
    assert(acmeToken.length > 20, "no code");
    await shot(rita, "01-started");
  },
);

const ana = await newPerson("ana");
let acmeId = "";
await check(
  "its owner signs up into it, alone there, and root has no seat in it",
  ana,
  async () => {
    await signUp(ana, "Ana Owner", "ana@example.invalid", acmeToken);
    const all = await mine(ana);
    assert(all.workspaces.length === 1, JSON.stringify(all));
    const acme = all.workspaces[0]!;
    assert(acme.slug === "acme-co" && acme.role === "owner", JSON.stringify(acme));
    acmeId = acme.id;
    assert(!all.mayCreate, "a workspace's owner may start workspaces");
    const ritas = await mine(rita);
    assert(
      ritas.workspaces.every((w) => w.id !== acmeId),
      "root has a seat in the new workspace",
    );
    // Nothing of Rita's workspace reaches Ana: not one of its bots.
    const ritaBots = await botIds(rita);
    const anaBots = await botIds(ana);
    assert(
      ritaBots.length > 0 && anaBots.every((id) => !ritaBots.includes(id)),
      "a bot crossed workspaces",
    );
    // Root asks for Acme by its address name: it stands in its own.
    const asked = await api(rita, "GET", "/api/workspace/");
    assert(asked.body.workspace.id !== acmeId, "root reached Acme");
  },
);

// ------------------------------------------------------------------------------------------------------------------------- a person in both
const bo = await newPerson("bo");
await check(
  "a person on the server joins a second workspace with an invitation for them, from the workspace menu",
  bo,
  async () => {
    await rita.goto(`${ORIGIN}/dashboard`);
    const toMain = await invite(rita, "bo@example.invalid");
    await signUp(bo, "Bo Both", "bo@example.invalid", toMain);
    await ana.goto(`${ORIGIN}/dashboard`);
    const toAcme = await invite(ana, "bo@example.invalid");
    await bo.goto(`${ORIGIN}/dashboard`);
    await switcher(bo, "Workspace").click();
    await bo.getByRole("menuitem", { name: "Join a workspace" }).click();
    await bo.locator('[name="token"]').fill(toAcme);
    await bo.getByRole("button", { name: "Join", exact: true }).click();
    await bo.waitForURL(/w=acme-co/);
    assert(new URL(bo.url()).pathname === "/dashboard", bo.url());
    const all = await mine(bo);
    assert(
      all.workspaces
        .map((w) => w.slug)
        .sort()
        .join(",") === "acme-co,main",
      JSON.stringify(all),
    );
    assert(
      all.workspaces.find((w) => w.current)?.slug === "acme-co",
      "the tab does not work in Acme",
    );
    await shot(bo, "02-joined");
  },
);

await check(
  "each workspace shows its own bots, the address keeps the workspace on every page and through Back and Forward",
  bo,
  async () => {
    const inAcme = await botIds(bo);
    await bo.goto(`${ORIGIN}/dashboard?w=main`);
    await switcher(bo, "Workspace").waitFor();
    const inMain = await botIds(bo);
    assert(inAcme.length && inMain.length, "no bots");
    assert(
      inAcme.every((id) => !inMain.includes(id)),
      "a bot is in both workspaces",
    );
    // A link inside the app keeps the workspace.
    await bo.goto(`${ORIGIN}/dashboard?w=acme-co`);
    await switcher(bo, "Acme Co").waitFor();
    await bo.locator('aside[aria-label="Sidebar"] nav[aria-label="Main"] a').first().click();
    await bo.waitForURL((u) => u.pathname !== "/dashboard");
    assert(
      new URL(bo.url()).searchParams.get("w") === "acme-co",
      `the link dropped the workspace: ${bo.url()}`,
    );
    await bo.goBack();
    assert(
      new URL(bo.url()).searchParams.get("w") === "acme-co",
      `Back lost the workspace: ${bo.url()}`,
    );
    await bo.goForward();
    assert(
      new URL(bo.url()).searchParams.get("w") === "acme-co",
      `Forward lost the workspace: ${bo.url()}`,
    );
    // Two tabs, two workspaces.
    const second = await bo.context().newPage();
    await second.goto(`${ORIGIN}/dashboard?w=main`);
    await switcher(second, "Workspace").waitFor();
    assert(
      (await mine(second)).workspaces.find((w) => w.current)?.slug === "main",
      "the second tab is not in main",
    );
    assert(
      (await mine(bo)).workspaces.find((w) => w.current)?.slug === "acme-co",
      "the first tab moved",
    );
    await second.close();
  },
);

await check("an address naming a workspace the person is not in opens their own", ana, async () => {
  await ana.goto(`${ORIGIN}/dashboard?w=main`);
  await switcher(ana, "Acme Co").waitFor();
  const here = await api(ana, "GET", "/api/workspace/");
  assert(here.body.workspace.id === acmeId, "Ana reached the main workspace");
});

// ------------------------------------------------------------------------------------------------------------------------- root's view
await check(
  "root sees every workspace with its people, suspends one and deletes it; its people lose it at once",
  rita,
  async () => {
    await rita.goto(`${ORIGIN}/studio/invites`);
    const row = rita.locator('li[aria-label="Acme Co"]');
    await row.waitFor();
    assert((await row.innerText()).includes("People: 2"), await row.innerText());
    await shot(rita, "03-operator");
    await row.getByRole("button", { name: "Suspend" }).click();
    await row.getByText("Suspended").waitFor();
    assert(
      (await mine(bo)).workspaces.every((w) => w.slug !== "acme-co"),
      "a suspended workspace is still listed",
    );
    await row.getByRole("button", { name: "Resume" }).click();
    await row.getByRole("button", { name: "Suspend" }).waitFor();
    await row.getByRole("button", { name: "Delete" }).click();
    await rita.getByRole("button", { name: "Delete workspace" }).click();
    await row.waitFor({ state: "detached" });
    assert(
      (await mine(bo)).workspaces.map((w) => w.slug).join(",") === "main",
      "Bo still has Acme",
    );
    // Ana stands in no workspace now: she sees no bots at all, never the main workspace's.
    assert((await botIds(ana)).length === 0, "Ana sees bots after her workspace was deleted");
  },
);

console.log("DONE");
await browser.close().catch(() => undefined);
process.exit(0);
