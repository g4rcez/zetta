// Records a computer demo by driving the real Zetta web app (the stack from stack.sh) with Playwright.
//
//   bun docs/demo/computer/record.ts browse     # Operator reads pages and asks for a sign-in; once with Cua, once with agent-desktop
//   bun docs/demo/computer/record.ts machines   # a second computer (Ubuntu) and a terminal on each
//   bun docs/demo/computer/record.ts team       # the Chief builds a team: brief, design, three steps of cards, a waiting room
//
// Run `stack.sh up` before each recording (the scripts expect a fresh installation). Output: $DEMO/rec/<name>/raw.webm and events.json
// (caption times and the waits that build-vm-demo.ts speeds up). The bot's replies come from the stand-in `claude` (no model call).
import { mkdirSync, readdirSync, renameSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { DEMO, ORIGIN, STATE, loadChromium } from "./lib.ts";

const scenario = process.argv[2];
if (scenario !== "browse" && scenario !== "machines" && scenario !== "team") {
  console.error("usage: bun docs/demo/computer/record.ts browse|machines|team");
  process.exit(2);
}
const SIZE = { width: 1600, height: 1000 };
const out = join(DEMO, "rec", scenario);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const browser = await (await loadChromium()).launch();
const context = await browser.newContext({
  ignoreHTTPSErrors: true,
  viewport: SIZE,
  storageState: STATE,
  recordVideo: { dir: out, size: SIZE },
});
const page = await context.newPage();
const t0 = Date.now();
page.setDefaultTimeout(90_000);

// A fake cursor (the video shows no real one) and no devtools badge. The cursor is a popover so that it stays above a modal dialog,
// which also lives in the top layer; raise() puts it back on top.
await page.addInitScript(() => {
  const boot = () => {
    const style = document.createElement("style");
    style.textContent =
      "#demo-cur{position:fixed;inset:auto;margin:0;padding:0;width:18px;height:18px;border-radius:50%;background:#fff;border:2px solid #111;box-shadow:0 0 0 2px #fff9;pointer-events:none;overflow:visible;transition:transform .08s}";
    document.head.append(style);
    const cur = document.createElement("div");
    cur.id = "demo-cur";
    cur.setAttribute("popover", "manual");
    cur.style.left = "-50px";
    cur.style.top = "0";
    document.body.append(cur);
    cur.showPopover();
    (window as unknown as { __raise: () => void }).__raise = () => {
      cur.hidePopover();
      cur.showPopover();
    };
    addEventListener(
      "mousemove",
      (e) => {
        cur.style.left = `${e.clientX - 3}px`;
        cur.style.top = `${e.clientY - 3}px`;
      },
      true,
    );
    addEventListener("mousedown", () => (cur.style.transform = "scale(.7)"), true);
    addEventListener("mouseup", () => (cur.style.transform = ""), true);
    // The router's devtools badge has generated class names: find it by its text and hide the fixed box around it.
    new MutationObserver(() => {
      for (const b of document.querySelectorAll("button")) {
        if (!/TanStack Router/.test(b.textContent ?? "")) continue;
        let el: HTMLElement | null = b;
        while (el && getComputedStyle(el).position !== "fixed") el = el.parentElement;
        (el ?? b).style.display = "none";
      }
    }).observe(document.body, { childList: true, subtree: true });
  };
  if (document.readyState === "loading") addEventListener("DOMContentLoaded", boot);
  else boot();
});

// What build-vm-demo.ts needs: when each caption starts, and which waits to speed up.
const now = () => Date.now() - t0;
const events: { t: number; text: string; chip?: string }[] = [];
const idles: { from: number; to: number }[] = [];
const caption = (text: string, chip?: string) =>
  events.push({ t: now(), text, ...(chip ? { chip } : {}) });
/** A wait that nobody wants to watch (a computer starting, a bot thinking): kept short in the video. */
async function idle<T>(work: () => Promise<T>): Promise<T> {
  const from = now();
  const result = await work();
  const to = now();
  if (to - from > 3000) idles.push({ from: from + 700, to: to - 700 });
  return result;
}
const log = (s: string) => console.log(`${(now() / 1000).toFixed(0).padStart(4)}s  ${s}`);
const wait = (ms: number) => page.waitForTimeout(ms);
const textMatches = (re: string, timeout = 120_000) =>
  page.waitForFunction((r) => new RegExp(r).test(document.body.innerText), re, { timeout });

const raise = () =>
  page.evaluate(() => (window as unknown as { __raise?: () => void }).__raise?.());
async function go(target: import("playwright-core").Locator) {
  await target.scrollIntoViewIfNeeded();
  const box = (await target.boundingBox())!;
  const x = box.x + box.width / 2;
  const y = box.y + box.height / 2;
  await raise();
  await page.mouse.move(x, y, { steps: 18 });
  await wait(220);
  await page.mouse.click(x, y);
}
const type = (text: string, delay = 22) => page.keyboard.type(text, { delay });

const fail = async (e: unknown) => {
  await page.screenshot({ path: join(DEMO, "record-fail.png") }).catch(() => undefined);
  console.error(
    `recording failed at ${page.url()}: ${e instanceof Error ? e.message : e}\nscreenshot: ${join(DEMO, "record-fail.png")}`,
  );
  process.exit(1);
};

/** A new chat with a bot, from the sidebar (the first button of that name: the bot's row also has one). */
async function newChat(bot = "Operator") {
  await go(page.getByRole("button", { name: `New chat with ${bot}` }).first());
  await wait(900);
}
async function say(message: string) {
  await go(page.locator(".cm-content").last());
  await type(message, 16);
  await wait(500);
  await page.keyboard.press("Enter");
}
const studioComputer = async () => {
  const link = page.getByRole("link", { name: "Computer", exact: true });
  if (!(await link.isVisible())) await go(page.getByText("More", { exact: true }).first());
  await go(link);
  await page.waitForSelector('section[aria-label="Computers"]');
  await wait(1500);
};
const computers = page.locator('section[aria-label="Computers"]');
const card = (name: string) => page.getByText(new RegExp(`Using the computer\\s*${name}`));

const SIGN_IN = "Look at example.com, then open the GitHub sign-in page.";
const HANDED_BACK = "I filled in the sign-in form and handed the computer back. Please carry on.";

/** One full run on the Default computer: ask, watch the card and the console, take over to sign in, hand back, let the bot go on. */
async function browseRun(chip: string) {
  await newChat();
  caption("Ask a bot to use a computer", chip);
  await say(SIGN_IN);
  log(`${chip}: sent`);
  await idle(() => textMatches("Using the computer"));
  caption("The chat shows the computer live, with each step the bot takes", chip);
  await wait(7000);
  await go(page.getByRole("button", { name: "Watch live", exact: true }));
  const screen = page.locator('[aria-label="Computer screen"]');
  await screen.locator("canvas").waitFor();
  await raise();
  caption("Open it to watch at full size, in the same dashboard", chip);
  log(`${chip}: console open`);
  await idle(() => textMatches("Used the computer"));
  await wait(2500);
  caption("The bot does not type passwords: it asks a person to take over", chip);
  await wait(3500);
  await go(page.getByRole("button", { name: "Take over" }));
  caption("Take over: the bot waits while you sign in", chip);
  await wait(2500);
  // Click the username field on the computer's screen (the sign-in page is 16:10 like the screen; the field sits at 50 % / 40 %). Only
  // the Cua driver leaves it focused after the page loads, so the click is what makes both drivers type into the form.
  const shown = (await screen.locator("canvas").boundingBox())!;
  await raise();
  await page.mouse.move(shown.x + shown.width * 0.5, shown.y + shown.height * 0.4, { steps: 18 });
  await page.mouse.click(shown.x + shown.width * 0.5, shown.y + shown.height * 0.4);
  await wait(500);
  await type("demo-user", 70);
  await wait(500);
  await page.keyboard.press("Tab");
  await wait(300);
  await type("dummy-password", 70);
  caption("What you type goes to the computer, not into the chat", chip);
  await wait(3500);
  await go(page.getByRole("button", { name: "Hand back" }));
  caption("Hand it back and the bot can work again", chip);
  await wait(2500);
  await go(page.getByRole("button", { name: "Close", exact: true }));
  await wait(800);
  await say(HANDED_BACK);
  log(`${chip}: handed back`);
  await idle(() => textMatches("never saw what you typed"));
  caption("The bot carries on from the screen you left it on", chip);
  await wait(4000);
}

async function browse() {
  await page.goto(`${ORIGIN}/studio/computer`);
  await page.waitForSelector('section[aria-label="Computers"]');
  const ready = now();
  caption("Studio > Computer: your private Linux computers", "Cua");
  await wait(3500);
  await browseRun("Cua");

  await studioComputer();
  caption("Each computer has a driver, chosen here while it is stopped", "Cua");
  await wait(2500);
  await go(page.getByRole("button", { name: "Stop" }));
  await idle(() => page.getByLabel("Driver for Default").waitFor());
  await wait(800);
  await go(page.getByLabel("Driver for Default"));
  await page.getByLabel("Driver for Default").selectOption({ label: "agent-desktop" });
  caption("Switch this computer to the agent-desktop driver", "agent-desktop");
  await wait(3500);
  await browseRun("agent-desktop");
  await finish(ready);
}

async function machines() {
  await page.goto(`${ORIGIN}/studio/computer`);
  await page.waitForSelector('section[aria-label="Computers"]');
  const ready = now();
  caption("Your default computer: Debian 13, driven by Cua", "Debian 13 · Cua");
  await wait(3500);
  caption("A new computer is a name, a system and a driver", "Ubuntu 24.04 · agent-desktop");
  await go(computers.getByPlaceholder("Name, e.g. Bank"));
  await type("Ubuntu", 60);
  await computers.getByLabel("System").selectOption({ label: "Ubuntu 24.04" });
  await wait(700);
  await computers.getByLabel("Driver", { exact: true }).selectOption({ label: "agent-desktop" });
  await wait(1200);
  await go(page.getByRole("button", { name: "Create", exact: true }));
  await computers.locator("li", { hasText: "Ubuntu" }).waitFor();
  await wait(3000);

  await newChat();
  caption("Ask the bot to run a command on both computers", "Debian 13 · Cua");
  await say(
    "Open a terminal on my default computer and on Ubuntu, and on each run uname -a and grep PRETTY_NAME /etc/os-release.",
  );
  log("sent");
  await idle(() => card("Default").waitFor());
  await wait(4000);
  await go(page.getByRole("button", { name: /^Watch/ }).first());
  await page.locator('[aria-label="Computer screen"] canvas').waitFor();
  await raise();
  caption("Default computer: a terminal on Debian 13", "Debian 13 · Cua");
  await wait(9000);
  await go(page.getByRole("button", { name: "Close", exact: true }));
  await idle(() => card("Ubuntu").waitFor());
  caption("The same bot moves on to the Ubuntu computer", "Ubuntu 24.04 · agent-desktop");
  await wait(3500);
  await go(page.getByRole("button", { name: /^Watch/ }).last());
  await page.locator('[aria-label="Computer screen"] canvas').waitFor();
  await raise();
  caption(
    "Ubuntu computer: its own terminal and its own os-release",
    "Ubuntu 24.04 · agent-desktop",
  );
  await wait(9000);
  await idle(() => textMatches("Done\\. Both computers"));
  await wait(2500);
  await go(page.getByRole("button", { name: "Close", exact: true }));
  await wait(1500);
  caption("The os-release lines tell the two systems apart", "Debian 13 · Cua");
  await wait(5000);

  await studioComputer();
  caption(
    "Both computers stay in Studio > Computer, each with its own system and driver",
    "2 computers",
  );
  await wait(5000);
  await finish(ready);
}

const BRIEF = "Build a team for our blog launch.";
const ANSWERS =
  "Goal: publish 3 posts in two weeks. Deliverables: the posts and a short newsletter. Limit: no paid tools.";
const GO_AHEAD = "Yes, go ahead.";

/** The cards of one step: the person approves each one. */
async function approveCards(count: number, chip: string) {
  for (let i = 0; i < count; i++) {
    const approve = page.getByRole("button", { name: "Approve", exact: true }).first();
    await approve.waitFor();
    await wait(1200);
    await go(approve);
    await wait(900);
  }
  log(`${chip}: ${count} approved`);
}

/** The Chief acts as a manager: it asks, posts a design, and after the go-ahead builds the team in three steps of cards. */
async function team() {
  await page.goto(`${ORIGIN}/chat`);
  // Two bots the person already has (made before the recording starts): the Chief reuses them and hires only what is missing.
  for (const [name, description] of [
    ["Researcher", "Finds sources and checks facts."],
    ["Writer", "Drafts blog posts and newsletters."],
  ] as const) {
    const made = await page.evaluate(
      async ([name, description]) =>
        (
          await fetch("/api/bots", {
            method: "POST",
            credentials: "include",
            headers: { "content-type": "application/json" },
            body: JSON.stringify({
              name,
              description,
              personality: `You are ${name}.`,
              instructions: "Do the job well and say what you did.",
              visibility: "team",
              harness: "claude-code",
            }),
          })
        ).status,
      [name, description] as const,
    );
    if (made >= 300) throw new Error(`creating ${name} failed: ${made}`);
  }
  await page.reload();
  await page.getByRole("button", { name: "New chat with Chief" }).first().waitFor();
  const ready = now();
  caption("Ask the Chief to build a team", "Brief");
  await wait(2500);
  await newChat("Chief");
  await say(BRIEF);
  log("brief sent");
  await idle(() => textMatches("Three quick questions"));
  caption("Like a manager, it asks for the brief first", "Brief");
  await wait(3500);

  await say(ANSWERS);
  await idle(() => textMatches("Shall I go ahead"));
  caption("It looks at your bots and posts a design. Nothing is created yet", "Design");
  await wait(9000);

  await say(GO_AHEAD);
  await idle(() => textMatches("Four cards wait"));
  caption("After your OK: Editor is hired and the team exists, with its goal and context", "Build");
  await wait(5000);
  caption("Roles and a new skill come as cards: you approve each one", "Cards");
  await wait(3500);
  await approveCards(4, "step 1");

  await idle(() => textMatches("Two cards wait for you"));
  caption("When you have decided every card, the Chief goes on by itself", "Next step");
  await wait(3500);
  await approveCards(2, "step 2");

  await idle(() => textMatches("Approve the room"));
  caption("Last step: the project room. It waits for you to start it", "Room");
  await wait(3500);
  await approveCards(1, "step 3");
  await wait(2500);

  await page.goto(`${ORIGIN}/teams`);
  await page.getByText("Blog launch", { exact: true }).first().waitFor();
  await raise();
  caption("The team: Researcher and Writer reused, Editor hired, each with a role", "Result");
  await wait(6000);
  await go(page.getByRole("link", { name: "Blog launch kickoff" }).first());
  await wait(2500);
  caption("The room is linked to the team. Nobody works in it until you write", "Result");
  await wait(6000);
  await finish(ready);
}

async function finish(ready: number) {
  const end = now();
  await context.close();
  await browser.close();
  const webm = readdirSync(out).find((f) => f.endsWith(".webm"));
  if (!webm) throw new Error("Playwright wrote no video");
  renameSync(join(out, webm), join(out, "raw.webm"));
  writeFileSync(
    join(out, "events.json"),
    JSON.stringify({ scenario, ready, end, events, idles }, null, 2),
  );
  log(`done: ${join(out, "raw.webm")}`);
}

await (scenario === "browse" ? browse() : scenario === "machines" ? machines() : team()).catch(
  fail,
);
