// Sets up the demo installation (fake data): the first-run onboarding, then a bot named Operator that may use computers.
// Saves the signed-in browser state to $DEMO/state.json for record.ts. Run by stack.sh up.
import { DEMO, ORIGIN, STATE, browserOptions, loadChromium, secrets } from "./lib.ts";
import { join } from "node:path";

const { setupKey, password } = secrets();
const browser = await (await loadChromium()).launch();
const context = await browser.newContext(browserOptions);
const page = await context.newPage();
// A wrong selector fails in seconds with a picture of the page, instead of waiting for the default 30 s per step.
page.setDefaultTimeout(20_000);
process.on("uncaughtException", async (e) => {
  await page.screenshot({ path: join(DEMO, "seed-fail.png") }).catch(() => undefined);
  console.error(`seed failed at ${page.url()}: ${e.message}\nscreenshot: ${join(DEMO, "seed-fail.png")}`);
  process.exit(1);
});

await page.goto(`${ORIGIN}/onboarding`);
await page.fill('[name="connection-key"]', setupKey);
await page.click('button[type="submit"]');
await page.getByRole("button", { name: "Continue" }).click();
await page.fill('[name="name"]', "Demo User");
await page.fill('[name="email"]', "demo@example.invalid");
await page.fill('[name="password"]', password);
await page.fill('[name="confirm"]', password);
await page.click('button[type="submit"]');

// The personal chief: every installation has one.
await page.getByLabel("Name", { exact: true }).waitFor();
await page.getByLabel("Name", { exact: true }).fill("Chief");
await page.getByLabel("Description").first().fill("Your personal chief of staff. Plans the day and hands work to the right specialist.");
await page.getByRole("button", { name: "Continue" }).click();
await page.getByText("What runs your Chief?").waitFor();
await page.locator('input[name="harness"][value="claude-code"]').check({ force: true });
await page.getByRole("button", { name: "Continue" }).click();
await page.getByText("I'll write it myself").click();
const editors = page.locator(".cm-content");
await editors.nth(0).click();
await page.keyboard.type("You are Chief, a calm and precise chief of staff. You keep answers short.");
await editors.nth(1).click();
await page.keyboard.type("Restate the goal in one line, then answer with the result and the next step. Never invent a result.");
await page.getByRole("button", { name: "Save my Chief" }).click();
await page.getByText("Connect your tools").waitFor();
await page.goto(`${ORIGIN}/onboarding?step=plugins`);
await page.getByRole("button", { name: "Start chatting" }).click();
await page.waitForURL(/chat/);

const api = (method: string, path: string, body?: unknown) =>
  page.evaluate(
    async ([method, path, body]) => {
      const res = await fetch(`/api${path}`, {
        method,
        credentials: "include",
        headers: { "content-type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      return { status: res.status, json: await res.json().catch(() => null) };
    },
    [method, path, body] as const,
  );

// "You are Operator" is how the stand-in `claude` (bin/claude) knows which bot is asking. computerMode "desktop" lets it use computers.
const made = await api("POST", "/bots", {
  name: "Operator",
  description: "Uses your computers: reads pages, runs commands, and asks you when a person is needed.",
  personality: "You are Operator, a careful assistant that works on the user's own computers and says what it sees.",
  instructions: "Use the user's computer for web and desktop work. Never type passwords: ask the user to take over.",
  visibility: "team",
  harness: "claude-code",
  computerMode: "desktop",
});
if (made.status >= 300) throw new Error(`creating Operator failed: ${made.status} ${JSON.stringify(made.json)}`);
const bots = ((await api("GET", "/bots")).json as { bots: { id: string; name: string; computerMode?: string; onboarded?: boolean }[] }).bots;
const operator = bots.find((b) => b.name === "Operator");
console.log("bots:", bots.map((b) => `${b.name}(${b.computerMode ?? "?"}, onboarded=${b.onboarded ?? "?"})`).join(", "));
if (!operator) throw new Error("Operator is missing after creation");
await Bun.write(STATE.replace(/state\.json$/, "operator.json"), JSON.stringify({ id: operator.id }));
await context.storageState({ path: STATE });
await browser.close();
console.log(`seeded; signed-in state in ${STATE}`);
