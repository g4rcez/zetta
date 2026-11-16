// An app page in a real browser: it is published from a playground, opened in its sandboxed frame, and the frame's promises are checked
// from outside: its tools answer, a change shows an approval bar that only the host can answer, a refusal reaches the page, and the
// frame has no cookies, no real origin and no network.
// Needs the isolated stack: `docs/demo/computer/stack.sh up` (stand-in engine, fake data), and a Chromium that playwright-core can start.
//   bun scripts/e2e/app-frame.ts
import { ORIGIN, STATE, browserOptions, loadChromium } from "../../docs/demo/computer/lib.ts";
import { existsSync } from "node:fs";
import { createReport } from "./report";

const report = createReport("app-frame", "Apps: a page in its frame, in a real browser");
if (!existsSync(STATE)) {
  report.skip("stack", "the demo stack is not up (run docs/demo/computer/stack.sh up first)");
  process.exit(report.finish("the isolated demo stack and a Chromium"));
}

const CODE = `import { defineApp, query, mutation, t } from "zetta-app";
export default defineApp({
  tools: {
    greet: query({ description: "Say hello", input: t.object({ name: t.string().default("world") }) }, async (_c, { name }) => ({ message: "Hello, " + name + "!" })),
    items: { remove: mutation({ description: "Remove an item", input: t.object({ id: t.string() }) }, async (_c, { id }) => ({ removed: id })) },
  },
});
`;
const PAGE = `<!doctype html><html><body>
<button id="greet">Greet</button> <button id="remove">Remove</button> <button id="net">Network</button>
<pre id="out"></pre>
<script>
const out = document.getElementById("out");
const show = (v) => { out.textContent = typeof v === "string" ? v : JSON.stringify(v); };
const run = (tool, input) => window.zetta.call(tool, input).then(show, (e) => show("ERR " + e.code));
document.getElementById("greet").onclick = () => run("greet", { name: "Zetta" });
document.getElementById("remove").onclick = () => run("items.remove", { id: "7" });
document.getElementById("net").onclick = () => fetch("https://example.com/").then(() => show("NETWORK OPEN"), () => show("NETWORK CLOSED"));
</script></body></html>`;

const browser = await (await loadChromium()).launch();
try {
  const context = await browser.newContext({ ...browserOptions, storageState: STATE });
  const page = await context.newPage();
  page.setDefaultTimeout(20_000);
  const api = (method: string, path: string, body?: unknown) =>
    page.evaluate(
      async ([method, path, body]) => {
        const res = await fetch(`/api${path}`, {
          method: method as string,
          headers: { "content-type": "application/json" },
          body: body ? JSON.stringify(body) : undefined,
        });
        return { status: res.status, json: await res.json().catch(() => ({})) };
      },
      [method, path, body] as const,
    );
  await page.goto(`${ORIGIN}/dashboard`);

  let slug = "";
  await report.check("a playground with a backend and a page is published as an app", async () => {
    const title = `E2E app ${Date.now().toString(36)}`;
    const made = await api("POST", "/playgrounds", {
      title,
      language: "typescript",
      runner: "host",
      entry: "index.ts",
      files: [
        { path: "index.ts", content: CODE },
        { path: "ui/index.html", content: PAGE },
      ],
    });
    if (made.status !== 201)
      throw new Error(
        `create playground: ${made.status} ${JSON.stringify(made.json).slice(0, 160)}`,
      );
    const pub = await api("POST", "/apps/publish", { playgroundId: made.json.playground.id });
    if (pub.status !== 201)
      throw new Error(`publish: ${pub.status} ${JSON.stringify(pub.json).slice(0, 200)}`);
    slug = pub.json.published.app.slug;
    return `slug ${slug}, ${pub.json.published.changes.added.length} tools`;
  });
  if (!slug) process.exit(report.finish("the isolated demo stack and a Chromium"));

  await page.goto(`${ORIGIN}/apps/${slug}`);
  const iframe = page.locator("iframe[sandbox]");
  await iframe.waitFor();
  const frame = page.frameLocator("iframe[sandbox]");
  const out = frame.locator("#out");

  await report.check(
    "the frame is sandboxed with scripts only: no same-origin, no popups, no top navigation",
    async () => {
      const sandbox = (await iframe.getAttribute("sandbox")) ?? "";
      const flags = sandbox.split(/\s+/).filter(Boolean).sort().join(" ");
      if (flags !== "allow-forms allow-scripts") throw new Error(`sandbox is "${flags}"`);
      return flags;
    },
  );
  await report.check("a query runs through the host and its answer reaches the page", async () => {
    await frame.locator("#greet").click();
    await page.waitForFunction(() => false, undefined, { timeout: 500 }).catch(() => undefined);
    const text = await out.innerText({ timeout: 15_000 });
    if (!text.includes("Hello, Zetta!")) throw new Error(`the page shows: ${text}`);
  });
  await report.check(
    "a change shows an approval bar outside the frame, and Allow lets it through",
    async () => {
      await frame.locator("#remove").click();
      const bar = page.getByRole("alertdialog");
      await bar.waitFor();
      const text = await bar.innerText();
      if (!/items\.remove/.test(text) || !/"id": "7"/.test(text))
        throw new Error(`the bar does not name the tool and input: ${text.slice(0, 160)}`);
      // The page cannot draw the bar: the dialog belongs to the host document.
      if ((await frame.getByRole("alertdialog").count()) !== 0)
        throw new Error("the dialog is inside the frame");
      await bar.getByRole("button", { name: "Allow" }).click();
      await page.waitForTimeout(300);
      const after = await out.innerText({ timeout: 15_000 });
      if (!after.includes("removed")) throw new Error(`after Allow the page shows: ${after}`);
    },
  );
  await report.check("Decline reaches the page as a rejection with code DECLINED", async () => {
    await frame.locator("#remove").click();
    const bar = page.getByRole("alertdialog");
    await bar.waitFor();
    await bar.getByRole("button", { name: "Decline" }).click();
    await page.waitForTimeout(300);
    const after = await out.innerText({ timeout: 15_000 });
    if (!after.includes("DECLINED")) throw new Error(`after Decline the page shows: ${after}`);
  });
  await report.check("the frame has an opaque origin, no cookies and no network", async () => {
    const inner = page.frames().find((f) => f !== page.mainFrame() && f.url() === "about:srcdoc");
    if (!inner) throw new Error("the frame document was not found");
    // Reading document.cookie in a sandboxed frame without allow-same-origin throws a SecurityError: that is the wanted answer.
    const facts = await inner.evaluate(() => {
      let cookie = "";
      try {
        cookie = document.cookie;
      } catch (e) {
        cookie = `blocked (${(e as Error).name})`;
      }
      return { origin: window.origin, cookie };
    });
    if (facts.origin !== "null") throw new Error(`origin is ${facts.origin}`);
    if (facts.cookie !== "" && !facts.cookie.startsWith("blocked"))
      throw new Error("the frame can see a cookie");
    await frame.locator("#net").click();
    await page.waitForTimeout(800);
    const net = await out.innerText();
    if (!net.includes("NETWORK CLOSED")) throw new Error(`fetch to the internet gave: ${net}`);
    return `origin "${facts.origin}", cookies ${facts.cookie || "none"}, network closed`;
  });
  await page
    .screenshot({ path: `${process.env.TMPDIR ?? "/tmp"}/zetta-e2e-app-frame.png` })
    .catch(() => undefined);
} finally {
  await browser.close();
}
report.note(
  "Chromium through playwright-core, against the isolated stack with its stand-in engine. Not covered: Firefox and Safari, a bot calling the app, and the app tool running in the container runner.",
);
process.exit(
  report.finish("the isolated demo stack (`docs/demo/computer/stack.sh up`) and a Chromium"),
);
