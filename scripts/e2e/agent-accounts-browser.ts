// The browser half of agent-accounts.ts. Runs under Node (not Bun: Playwright's websocket to the browser never connects under Bun), drives
// Helium over the DevTools protocol, and prints one `RESULT {json}` line per check. Do not run it by hand: `bun scripts/e2e/agent-accounts.ts`.
//
// Two people, each in a browser context of their own: Rita sets the server up and connects accounts, Bo is invited as a member.
// The sign-ins of Codex and Claude Code are the real commands of the CLIs on this computer, started by the real server and stopped at
// the link: nothing is signed in, and no real key or token is used anywhere.
import { mkdirSync } from "node:fs";
import { join } from "node:path";

type Page = import("playwright-core").Page;

const env = (name: string) => {
  const v = process.env[name];
  if (!v) throw new Error(`${name} is not set`);
  return v;
};
const ORIGIN = env("ACCOUNTS_E2E_ORIGIN");
const SHOTS = env("ACCOUNTS_E2E_SHOTS");
const CDP = env("ACCOUNTS_E2E_CDP");
const ACCOUNT_PASSWORD = env("ACCOUNTS_E2E_ACCOUNT_PASSWORD");
const SETUP_KEY = env("ACCOUNTS_E2E_SETUP_KEY");
const CLIS = (process.env.ACCOUNTS_E2E_CLIS ?? "").split(",").filter(Boolean);
mkdirSync(SHOTS, { recursive: true });
// Made up for this run: it only has to look like a key.
const FAKE_KEY = `sk-ant-fake-${Math.random().toString(36).slice(2)}-for-test-only`;

const { chromium } = (await import(
  env("ACCOUNTS_E2E_PLAYWRIGHT")
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
      return { status: response.status, text, body: JSON.parse(text || "null") };
    },
    [method, path, body ?? null] as const,
  );
const status = (page: Page) =>
  page.evaluate(async () =>
    (await fetch("/api/identity/status", { credentials: "include" })).json(),
  );
/** The row of one engine on the Accounts page. */
const engineRow = (page: Page, label: string) =>
  panel(page)
    .locator("li")
    .filter({ has: page.locator("p.font-medium", { hasText: label }) })
    .first();
const openAccounts = async (page: Page) => {
  await page.goto(`${ORIGIN}/studio/accounts`);
  await engineRow(page, "Claude Code").waitFor();
  await engineRow(page, "Claude Code").getByRole("button").first().waitFor();
};
type Account = { id: string; engine: string; kind: string; provider: string | null; use: string };
const myAccounts = async (page: Page) =>
  (await api(page, "GET", "/api/engine-accounts/")).body.accounts as Account[];

// ------------------------------------------------------------------------------------------------------------------------- setup
await check("the first account sets the server up", rita, async () => {
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
});

await check(
  "the Accounts page lists the engines, and says whose sign-in runs a person with no account",
  rita,
  async () => {
    await openAccounts(rita);
    const text = (await panel(rita).innerText()).replace(/\s+/g, " ");
    for (const engine of ["Claude Code", "Codex", "Pi", "OMP"])
      assert(text.includes(engine), `${engine} is not listed`);
    assert(
      text.includes("Your bots run on the server's own sign-in, which everyone here shares."),
      "the sentence about the server's own sign-in is missing",
    );
    assert((await myAccounts(rita)).length === 0, "a new person already has an account");
    await shot(rita, "01-accounts-empty");
  },
);

// ------------------------------------------------------------------------------------------------------------------------- paste
let ritaAccount = "";
await check(
  "a pasted key is sealed on its way, becomes the account in use, and is never shown again",
  rita,
  async () => {
    const requests: string[] = [];
    const listen = (request: import("playwright-core").Request) => {
      if (request.url().includes("/api/engine-accounts") && request.method() === "POST")
        requests.push(request.postData() ?? "");
    };
    rita.on("request", listen);
    const row = engineRow(rita, "Claude Code");
    await row.getByRole("button", { name: "Connect my account" }).click();
    await row.getByRole("button", { name: "Paste an API key" }).click();
    await row.locator('[name="secret"]').fill(FAKE_KEY);
    await row.locator('[name="label"]').fill("Console key");
    await row.getByRole("button", { name: "Connect", exact: true }).click();
    await row.getByText("Console key").waitFor();
    rita.off("request", listen);
    assert(requests.length === 1, `expected one request, saw ${requests.length}`);
    assert(!requests[0]!.includes(FAKE_KEY), "the key left the browser in the open");
    assert(requests[0]!.includes('"sealed"'), "the request carries no sealed part");
    const mine = await myAccounts(rita);
    assert(mine.length === 1 && mine[0]!.engine === "claude-code", JSON.stringify(mine));
    assert(
      mine[0]!.kind === "api_key" &&
        mine[0]!.provider === "anthropic" &&
        mine[0]!.use === "default",
      JSON.stringify(mine[0]),
    );
    ritaAccount = mine[0]!.id;
    const listed = await api(rita, "GET", "/api/engine-accounts/");
    assert(!listed.text.includes(FAKE_KEY), "the list of accounts holds the key");
    assert(!(await rita.content()).includes(FAKE_KEY), "the page still holds the key");
    assert((await row.locator('[name="secret"]').count()) === 0, "the field is still on the page");
    await shot(rita, "02-key-connected");
  },
);

// ------------------------------------------------------------------------------------------------------------------------- real sign-ins
async function realSignIn(
  engine: string,
  way: string,
  link: RegExp,
  more: (row: ReturnType<typeof engineRow>) => Promise<void>,
) {
  await openAccounts(rita);
  const before = (await myAccounts(rita)).length;
  const row = engineRow(rita, engine);
  await row.getByRole("button", { name: /Connect (my|another) account/ }).click();
  await row.getByRole("button", { name: way }).click();
  await row.getByRole("button", { name: "Start sign-in" }).click();
  const anchor = row.locator("a[target=_blank]");
  await anchor.waitFor({ timeout: 60_000 });
  const href = (await anchor.getAttribute("href")) ?? "";
  assert(link.test(href), `the link is ${href.slice(0, 60)}`);
  assert(
    (await anchor.getAttribute("rel"))?.includes("noopener"),
    "the link can reach back into the app",
  );
  await more(row);
  await shot(rita, `03-sign-in-${engine}`);
  await row.getByRole("button", { name: "Cancel" }).click();
  await rita.waitForTimeout(1500);
  // Cancelled: nothing was connected, and the page offers to start again.
  assert((await myAccounts(rita)).length === before, "a cancelled sign-in left an account");
  await row.getByRole("button", { name: "Start sign-in" }).waitFor();
  return new URL(href).host;
}

if (CLIS.includes("codex"))
  await check(
    "Codex's own sign-in, started by the server: its link and one-time code reach the page",
    rita,
    async () =>
      realSignIn(
        "Codex",
        "Sign in with your ChatGPT plan",
        /^https:\/\/auth\.openai\.com\//,
        async (row) => {
          const code = (await row.locator("code").innerText()).trim();
          assert(/^[A-Z0-9]{4}-[A-Z0-9]{4,6}$/.test(code), "no one-time code is shown");
          assert(
            (await row.locator('[name="code"]').count()) === 0,
            "Codex asks for a code it does not take",
          );
        },
      ),
  );
else
  out(
    "Codex's own sign-in, started by the server",
    "skip",
    "codex is not installed on this computer",
  );

if (CLIS.includes("claude"))
  await check(
    "Claude Code's own sign-in, started by the server in a terminal: its link reaches the page, and it waits for the code",
    rita,
    async () =>
      realSignIn(
        "Claude Code",
        "Sign in with your Claude subscription",
        /^https:\/\/[a-z.]+\/oauth\/authorize/,
        async (row) => {
          await row.locator('[name="code"]').waitFor();
        },
      ),
  );
else
  out(
    "Claude Code's own sign-in, started by the server in a terminal",
    "skip",
    "claude is not installed on this computer",
  );

if (CLIS.includes("omp"))
  await check(
    "OMP's own sign-in, started by the server: its link reaches the page, and it waits for the code",
    rita,
    async () =>
      realSignIn(
        "OMP",
        "Sign in with your Claude subscription",
        /^https:\/\/[a-z.]+\/oauth\/authorize/,
        async (row) => {
          await row.locator('[name="code"]').waitFor();
        },
      ),
  );
else
  out("OMP's own sign-in, started by the server", "skip", "omp is not installed on this computer");

// ------------------------------------------------------------------------------------------------------------------------- per bot
await check(
  "the owner of a bot chooses which account runs it and who pays in a room",
  rita,
  async () => {
    const bots = (await api(rita, "GET", "/api/bots")).body.bots as {
      id: string;
      canEdit: boolean;
    }[];
    const mine = bots.find((b) => b.canEdit)!;
    await rita.goto(`${ORIGIN}/bots/${mine.id}/settings`);
    const section = rita.locator('section[aria-label="Engine and account for you"]');
    await section.waitFor();
    assert(
      (await section.innerText()).includes("Your account for this bot"),
      "the owner's heading is missing",
    );
    await section.getByLabel("In a room, this bot runs on").selectOption("owner_in_rooms");
    await section.getByRole("button", { name: "Save", exact: true }).click();
    await rita.getByText("Saved.").first().waitFor();
    const choice = (await api(rita, "GET", `/api/engine-accounts/bots/${mine.id}`)).body.choice;
    assert(
      choice.owner === true && choice.sharedAccount === "owner_in_rooms",
      JSON.stringify(choice),
    );
    await shot(rita, "04-bot-choice");
  },
);

await check(
  "the setting that sends people without an account to the server's own sign-in is there, and root can turn it off",
  rita,
  async () => {
    await rita.goto(`${ORIGIN}/studio/settings`);
    const row = rita.locator(
      `form[aria-label="People without an agent account run on the server's own sign-in"]`,
    );
    await row.waitFor();
    assert(
      (await row.innerText()).includes("Security policy"),
      "it is not marked as security policy",
    );
    const off = await api(rita, "PUT", "/api/settings/serverLogin", { value: "off" });
    assert(off.status === 200, `turning it off answered ${off.status}`);
    assert(
      (await api(rita, "GET", "/api/engine-accounts/")).body.serverLogin === "off",
      "the accounts page does not see it",
    );
    await api(rita, "PUT", "/api/settings/serverLogin", { value: "allowed" });
  },
);

// ------------------------------------------------------------------------------------------------------------------------- other people
let token = "";
await check("root invites a member", rita, async () => {
  await rita.goto(`${ORIGIN}/studio/invites`);
  await rita.getByRole("heading", { name: "Invite a member" }).waitFor();
  await rita.fill("#invited-email", "bo@example.invalid");
  await rita.getByRole("button", { name: "Create invitation" }).click();
  await rita.locator("#issued-token").waitFor();
  token = await rita.locator("#issued-token").inputValue();
});

const bo = wire(
  await (await browser.newContext({ viewport: { width: 1360, height: 900 } })).newPage(),
  "bo",
);
await check("another person sees none of root's accounts and cannot touch one", bo, async () => {
  await bo.goto(`${ORIGIN}/login`);
  await bo.getByRole("button", { name: "Create an account" }).click();
  await bo.fill("#signup-name", "Bo Member");
  await bo.fill("#signup-email", "bo@example.invalid");
  await bo.fill("#signup-password", ACCOUNT_PASSWORD);
  await bo.fill("#signup-invitation", token);
  await bo.getByRole("button", { name: "Create account with invitation" }).click();
  for (let i = 0; i < 40; i++) {
    if (((await status(bo).catch(() => null)) as { state?: string } | null)?.state === "active")
      break;
    await bo.waitForTimeout(500);
  }
  assert((await myAccounts(bo)).length === 0, "a new member already has an account");
  for (const [method, path] of [
    ["DELETE", `/api/engine-accounts/${ritaAccount}`],
    ["PUT", `/api/engine-accounts/${ritaAccount}/default`],
    ["GET", "/api/engine-accounts/people"],
  ] as const) {
    const answer = await api(bo, method, path);
    assert(
      answer.status === 404 || answer.status === 403,
      `${method} ${path} answered ${answer.status}`,
    );
  }
  assert(
    (await myAccounts(rita)).some((a) => a.id === ritaAccount),
    "root's account is gone",
  );
});

await check(
  "the People page shows which engines each person connected, and nothing of the secret",
  rita,
  async () => {
    await rita.goto(`${ORIGIN}/studio/invites`);
    const list = panel(rita).locator('[aria-label="Agent accounts of Rita Root"]');
    await list.waitFor();
    const text = (await list.innerText()).replace(/\s+/g, " ");
    assert(text.includes("Claude Code") && text.includes("API key"), text);
    assert(!text.includes("Console key"), "the name of the account is shown to administrators");
    assert(
      (await panel(rita).locator('[aria-label="Agent accounts of Bo Member"]').count()) === 0,
      "a person with no account has a list",
    );
    const overview = await api(rita, "GET", "/api/engine-accounts/people");
    assert(
      !overview.text.includes("Console key") && !overview.text.includes(FAKE_KEY),
      "the overview holds a name or a secret",
    );
    await shot(rita, "05-people-accounts");
  },
);

await check(
  "disconnecting an account removes it, and the page goes back to the server's own sign-in",
  rita,
  async () => {
    await openAccounts(rita);
    const row = engineRow(rita, "Claude Code");
    await row.getByRole("button", { name: "Disconnect" }).click();
    await row.getByRole("button", { name: "Disconnect" }).click();
    await row.getByText("No account of yours.").waitFor();
    assert((await myAccounts(rita)).length === 0, "the account is still there");
  },
);

console.log("DONE");
await browser.close().catch(() => undefined);
process.exit(0);
