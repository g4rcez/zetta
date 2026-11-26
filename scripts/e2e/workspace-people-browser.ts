// The browser half of workspace-people.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/workspace-people.ts`.
//
// Three people, each in a browser context of their own: Rita sets the server up (root), Ana is invited as an administrator with Rita's
// Chief as hers, Bo is invited as a member with a Chief of his own.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("PEOPLE_E2E_ORIGIN");
const SHOTS = env("PEOPLE_E2E_SHOTS");
const CDP = env("PEOPLE_E2E_CDP");
const ACCOUNT_PASSWORD = env("PEOPLE_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("PEOPLE_E2E_SETUP_KEY");
mkdirSync(SHOTS, { recursive: true });

const { chromium } = (await import(
  env("PEOPLE_E2E_PLAYWRIGHT")
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
/** A person with a session of their own. */
async function person(who: string) {
  const own = await browser.newContext({ viewport: { width: 1360, height: 900 } });
  return wire(await own.newPage(), who);
}

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

const panel = (page: Page) => page.locator("#studio-panel");
const text = async (page: Page) => (await panel(page).innerText()).replace(/\s+/g, " ");
/** What the server says this session is. */
const status = (page: Page) =>
  page.evaluate(async () =>
    (await fetch("/api/identity/status", { credentials: "include" })).json(),
  );
const api = (page: Page, method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([m, p, b]) => {
      const response = await fetch(p as string, {
        method: m as string,
        credentials: "include",
        headers: b ? { "content-type": "application/json" } : undefined,
        body: b ? JSON.stringify(b) : undefined,
      });
      return { status: response.status, body: await response.json().catch(() => null) };
    },
    [method, path, body ?? null] as const,
  );
const openPeople = async (page: Page) => {
  await page.goto(`${ORIGIN}/studio/invites`);
  await page.getByRole("heading", { name: "Invite a member" }).waitFor();
};
/** The row of one person in the People list. */
const personRow = (page: Page, name: string) =>
  panel(page).locator("li").filter({ hasText: name }).first();

/** Fills the invitation form and returns the token shown once. */
async function invite(page: Page, email: string, choose: { role?: string; chief?: string } = {}) {
  await openPeople(page);
  await page.fill("#invited-email", email);
  if (choose.role) await page.selectOption('select[name="role"]', choose.role);
  if (choose.chief) {
    // The bot picker: open it, and take the bot by its name among choices that also say what each bot is for.
    await page.getByRole("combobox", { name: "Their Chief" }).click();
    await page.getByRole("option").filter({ hasText: choose.chief }).first().click();
  }
  await page.getByRole("button", { name: "Create invitation" }).click();
  await page.locator("#issued-token").waitFor();
  const token = await page.locator("#issued-token").inputValue();
  assert(/^[A-Za-z0-9_-]{43}$/.test(token), "no token was shown");
  return token;
}

/** Creates an account with an invitation, through the real sign-up form, and waits until the server calls it active. */
async function join_(page: Page, name: string, email: string, token: string) {
  await page.goto(`${ORIGIN}/login`);
  await page.getByRole("button", { name: "Create an account" }).click();
  await page.fill("#signup-name", name);
  await page.fill("#signup-email", email);
  await page.fill("#signup-password", ACCOUNT_PASSWORD);
  await page.fill("#signup-invitation", token);
  await page.getByRole("button", { name: "Create account with invitation" }).click();
  for (let i = 0; i < 40; i++) {
    const now = (await status(page).catch(() => null)) as { state?: string } | null;
    if (now?.state === "active") return;
    await page.waitForTimeout(500);
  }
  throw new Error(`${name} did not become an active member`);
}

// ------------------------------------------------------------------------------------------------------------------------- root
await check(
  "the first account sets the server up and is root, the owner of the workspace",
  rita,
  async () => {
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
    const now = (await status(rita)) as Record<string, unknown>;
    assert(
      now.isRoot === true && now.isAdmin === true && now.role === "owner",
      JSON.stringify(now),
    );
    const mine = await api(rita, "GET", "/api/workspace/");
    assert(
      mine.status === 200 && mine.body.role === "owner" && mine.body.isRoot === true,
      JSON.stringify(mine),
    );
    return `workspace "${mine.body.workspace.name}"`;
  },
);

await check(
  "Studio has a People page: root is listed as the owner, with no role to change",
  rita,
  async () => {
    await rita.goto(`${ORIGIN}/studio/overview`);
    await rita
      .getByRole("navigation", { name: "Studio sections" })
      .getByRole("link", { name: "People" })
      .click();
    await rita.waitForURL(/\/studio\/invites/);
    await rita.getByRole("heading", { name: "Invite a member" }).waitFor();
    const row = personRow(rita, "Rita Root");
    await row.waitFor();
    const t = (await row.innerText()).replace(/\s+/g, " ");
    assert(t.includes("You") && t.includes("Owner"), t);
    assert((await row.locator("select").count()) === 0, "root's own row offers a role");
    await shot(rita, "01-people-root");
  },
);

let anaToken = "";
await check("root invites an administrator and gives their own Chief as hers", rita, async () => {
  anaToken = await invite(rita, "ana@example.invalid", { role: "admin", chief: "Zetta" });
  await shot(rita, "02-invitation-created");
  await rita.getByRole("button", { name: "Hide token" }).click();
  await rita.getByRole("button", { name: "Finish" }).click();
  const t = await text(rita);
  assert(t.includes("ana@example.invalid"), "the pending invitation is not listed");
  assert(t.includes("Administrator") && t.includes("Will be their Chief"), t.slice(0, 600));
  assert(!t.includes(anaToken), "the token is still on the page");
});

// ------------------------------------------------------------------------------------------------------------------------- ana
const ana = await person("ana");
await check("the invited person signs up, is an administrator and not root", ana, async () => {
  await join_(ana, "Ana Admin", "ana@example.invalid", anaToken);
  const now = (await status(ana)) as Record<string, unknown>;
  assert(now.isAdmin === true && now.isRoot === false && now.role === "admin", JSON.stringify(now));
});

await check(
  "her Chief is root's bot: no setup of her own, and she can open a chat with it",
  ana,
  async () => {
    await ana.goto(`${ORIGIN}/`);
    // The guard sends a new member to the onboarding, which finishes at once for a Chief someone shared, and opens the app.
    await ana.waitForURL((url) => /^\/(dashboard|chat)/.test(url.pathname), { timeout: 60_000 });
    const bots = (await api(ana, "GET", "/api/bots")).body.bots as {
      id: string;
      name: string;
      kind: string;
      canEdit: boolean;
    }[];
    const chiefs = bots.filter((b) => b.kind === "chief");
    assert(
      chiefs.length === 1,
      `expected one chief, got ${JSON.stringify(bots.map((b) => [b.name, b.kind]))}`,
    );
    assert(
      chiefs[0]!.canEdit === false,
      "the shared Chief is editable by the person it was shared with",
    );
    assert(!bots.some((b) => b.canEdit), "a Chief of her own was created too");
    const prefs = (await api(ana, "GET", "/api/preferences")).body.preferences as {
      memberOnboarding?: string;
    };
    assert(prefs.memberOnboarding === "done", `member onboarding is ${prefs.memberOnboarding}`);
    const chat = await api(ana, "POST", "/api/conversations", { botId: chiefs[0]!.id });
    assert(chat.status === 200 || chat.status === 201, `opening a chat answered ${chat.status}`);
    await shot(ana, "03-ana-chat");
    return `chief "${chiefs[0]!.name}"`;
  },
);

await check(
  "an administrator who is not root sees the people, and may not touch the owner or her own role",
  ana,
  async () => {
    await openPeople(ana);
    const root = personRow(ana, "Rita Root");
    await root.waitFor();
    const rootText = (await root.innerText()).replace(/\s+/g, " ");
    assert(rootText.includes("Set this server up") && rootText.includes("Owner"), rootText);
    assert(
      (await root.locator("select").count()) === 0,
      "an administrator is offered the owner's role",
    );
    const mine = personRow(ana, "Ana Admin");
    assert(
      (await mine.locator("select").count()) === 0,
      "an administrator is offered her own role",
    );
    assert(
      (await ana.locator('select[name="role"]').count()) === 0,
      "an administrator may choose a role for an invitation",
    );
    await shot(ana, "04-people-admin");
  },
);

await check(
  "the server's settings are shown to her and not hers to change; a workspace's are",
  ana,
  async () => {
    await ana.goto(`${ORIGIN}/studio/settings`);
    await ana.getByRole("heading", { name: "Bot runs", exact: false }).first().waitFor();
    const t = await text(ana);
    assert(
      t.includes("You administer this workspace."),
      "the sentence for a workspace administrator is missing",
    );
    const locked = ana.locator('form[aria-label="Bot runs at once, in total"]');
    assert(
      (await locked.innerText()).includes("Decided for the whole server"),
      "the server limit is not marked",
    );
    assert(
      (await locked.getByRole("button", { name: "Save", exact: true }).count()) === 0,
      "the server limit has a Save button",
    );
    assert(
      await locked.locator('input[name="harnessMax"]').isDisabled(),
      "the server limit can be typed in",
    );
    const open = ana.locator('form[aria-label="Light background runs"]');
    await open.locator('input[name="lightRuns"]').evaluate((el: HTMLInputElement) => el.click());
    await open.getByRole("button", { name: "Save", exact: true }).click();
    await open.getByText("Saved.").waitFor();
    // And the server refuses what the page does not offer.
    const forced = await api(ana, "PUT", "/api/settings/harnessMax", { value: 2 });
    assert(
      forced.status === 403,
      `the server answered ${forced.status} to a change of its own limit`,
    );
    const key = await api(ana, "PATCH", "/api/installation", { updateCheck: "off" });
    assert(key.status === 403, `the server answered ${key.status} to a change of the installation`);
    await shot(ana, "05-settings-admin");
  },
);

// ------------------------------------------------------------------------------------------------------------------------- bo
let boToken = "";
await check("an administrator invites a member (and only a member)", ana, async () => {
  boToken = await invite(ana, "bo@example.invalid");
  const refused = await api(ana, "POST", "/api/identity/invitations", {
    intendedEmail: "eve@example.invalid",
    role: "admin",
  });
  assert(refused.status === 409, `inviting an administrator answered ${refused.status}`);
});

const bo = await person("bo");
await check("a member with a Chief of his own goes through his own setup", bo, async () => {
  await join_(bo, "Bo Member", "bo@example.invalid", boToken);
  const now = (await status(bo)) as Record<string, unknown>;
  assert(
    now.isAdmin === false && now.isRoot === false && now.role === "member",
    JSON.stringify(now),
  );
  await bo.goto(`${ORIGIN}/`);
  await bo.waitForURL(/\/onboarding/, { timeout: 60_000 });
  await bo.getByLabel("Name", { exact: true }).waitFor();
  const bots = (await api(bo, "GET", "/api/bots")).body.bots as {
    kind: string;
    canEdit: boolean;
  }[];
  assert(
    bots.filter((b) => b.kind === "chief" && b.canEdit).length === 1,
    "he has no Chief of his own",
  );
  // A member reads his workspace and administers nothing.
  assert(
    (await api(bo, "GET", "/api/workspace/")).body.role === "member",
    "his role is not member",
  );
  for (const path of ["/api/workspace/members", "/api/workspace/invitations", "/api/settings"])
    assert((await api(bo, "GET", path)).status === 403, `${path} answered a member`);
  await shot(bo, "06-bo-onboarding");
});

// ------------------------------------------------------------------------------------------------------------------------- roles
await check(
  "root makes the member an administrator from the list, and it holds after a reload",
  rita,
  async () => {
    await openPeople(rita);
    const row = personRow(rita, "Bo Member");
    await row.waitFor();
    await row.locator("select").first().selectOption("admin");
    await rita.getByText("Bo Member is now administrator.").waitFor();
    await rita.reload();
    await personRow(rita, "Bo Member").waitFor();
    const value = await personRow(rita, "Bo Member").locator("select").first().inputValue();
    assert(value === "admin", `the list shows ${value}`);
    const now = (await status(bo)) as Record<string, unknown>;
    assert(
      now.role === "admin" && now.isAdmin === true,
      `his next request says ${JSON.stringify(now)}`,
    );
    await shot(rita, "07-people-roles");
  },
);

await check(
  "a workspace keeps its owner: the server refuses to demote root, whoever asks",
  rita,
  async () => {
    const members = (await api(rita, "GET", "/api/workspace/members")).body.members as {
      userId: string;
      name: string;
    }[];
    const root = members.find((m) => m.name === "Rita Root")!;
    const self = await api(rita, "PUT", `/api/workspace/members/${root.userId}/role`, {
      role: "admin",
    });
    assert(self.status === 403, `root demoting root answered ${self.status}`);
    const other = await api(ana, "PUT", `/api/workspace/members/${root.userId}/role`, {
      role: "member",
    });
    assert(other.status === 403, `an administrator demoting root answered ${other.status}`);
    return self.body?.error?.message ?? "";
  },
);

await check("root takes the shared Chief away, and she gets one of her own", rita, async () => {
  await openPeople(rita);
  const row = personRow(rita, "Ana Admin");
  await row.waitFor();
  assert(
    (await row.innerText()).includes("Shared with them as their Chief"),
    "the share is not shown",
  );
  await row.getByRole("button", { name: "Take away" }).click();
  await row.getByRole("button", { name: "Stop sharing" }).click();
  await rita.getByText("Ana Admin has a Chief of their own again.").waitFor();
  const bots = (await api(ana, "GET", "/api/bots")).body.bots as {
    kind: string;
    canEdit: boolean;
  }[];
  const chiefs = bots.filter((b) => b.kind === "chief");
  assert(chiefs.length === 1 && chiefs[0]!.canEdit, `her chiefs now: ${JSON.stringify(chiefs)}`);
  await shot(rita, "08-chief-taken");
});

console.log("DONE");
await browser.close().catch(() => undefined);
process.exit(0);
