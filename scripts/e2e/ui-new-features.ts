// The new screens in a real browser (Chromium through Playwright) on the isolated demo stack: beta marks, the thumbs on a reply, the
// Quality tab (numbers, saved tests, history and restoring a version), the microphone with a fake input device, and a workflow with the
// new steps that stops at an approval. The server code is the real one; the only fakes are the audio device and the words returned for it
// (speech to text itself is checked in voice.ts).
// Needs the demo stack: ZETTA_DEMO_ENGINE=<podman or docker> docs/demo/computer/stack.sh up
//   bun scripts/e2e/ui-new-features.ts
import { existsSync } from "node:fs";
import { ORIGIN, STATE, browserOptions, loadChromium } from "../../docs/demo/computer/lib.ts";
import { createReport } from "./report";

const report = createReport("ui-new-features", "New screens in a real browser");
if (!existsSync(STATE)) {
  report.skip("browser", "the demo stack is not up (run docs/demo/computer/stack.sh up first)");
  process.exit(report.finish("the demo stack and Playwright's Chromium"));
}
const engine =
  process.env.ZETTA_DEMO_ENGINE ??
  Bun.which("podman") ??
  Bun.which("docker") ??
  "/opt/podman/bin/podman";
/** One statement; the first line of what it prints (an `insert … returning id` also prints its row count). */
const sql = async (q: string) =>
  (
    await Bun.$`${engine} exec zetta-demo-pg psql -U postgres -d zetta_demo -At -c ${q}`
      .quiet()
      .text()
  )
    .trim()
    .split("\n")[0]!;

const chromium = await loadChromium();
const browser = await chromium.launch({
  args: ["--use-fake-device-for-media-stream", "--use-fake-ui-for-media-stream"],
});
try {
  const context = await browser.newContext({
    ...browserOptions,
    storageState: STATE,
    permissions: ["microphone"],
  });
  const page = await context.newPage();
  page.setDefaultTimeout(15_000);
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
  // With SHOTS=<folder> a failed check leaves a screenshot of what the page showed.
  const check = async (name: string, run: () => Promise<string | void>) => {
    await report.check(name, async () => {
      try {
        return await run();
      } catch (e) {
        if (process.env.SHOTS)
          await page.screenshot({
            path: `${process.env.SHOTS}/${name.slice(0, 24).replace(/\W+/g, "-")}.png`,
          });
        throw e;
      }
    });
  };
  await page.goto(`${ORIGIN}/dashboard`);
  await page.waitForSelector("text=Projects");
  const bots = (await api("GET", "/bots")).json.bots as {
    id: string;
    name: string;
    version: number;
  }[];
  const op = bots.find((b) => b.name === "Operator")!;

  await report.check(
    "Beta marks sit next to Projects, Skills and Apps in the sidebar",
    async () => {
      const rows = await page
        .locator("nav a, aside a, a")
        .evaluateAll((els) =>
          els
            .map((e) => (e as HTMLElement).innerText.replace(/\s+/g, " ").trim())
            .filter((t) => /^(Projects|Skills|Apps)\b/.test(t)),
        );
      const marked = rows.filter((t) => /Beta/.test(t));
      if (marked.length < 3) throw new Error(`rows: ${JSON.stringify(rows)}`);
      return rows.join(" | ");
    },
  );

  // --- thumbs on a reply -------------------------------------------------------------------------------------------------------------
  const owner = await sql(`select id from zetta."user" limit 1`);
  const conv = await sql(
    `insert into zetta.conversation (owner_user_id, bot_id, title) values ('${owner}', '${op.id}', 'Browser check') returning id`,
  );
  await sql(
    `insert into zetta.message (conversation_id, owner_user_id, seq, role, content) values ('${conv}', '${owner}', 1, 'user', 'How long does shipping take?')`,
  );
  await sql(
    `insert into zetta.message (conversation_id, owner_user_id, seq, role, content, author_bot_id, bot_version) values ('${conv}', '${owner}', 2, 'assistant', 'Shipping takes about nine weeks.', '${op.id}', ${op.version}) returning id`,
  );
  await page.goto(`${ORIGIN}/chat/${conv}`);
  await page.waitForSelector("text=Shipping takes about nine weeks.");
  const messageRow = page.locator("text=Shipping takes about nine weeks.").first();
  await messageRow.hover();
  await check("A thumb up on a reply is saved", async () => {
    await page.getByRole("button", { name: "Good answer" }).first().click();
    await page.waitForTimeout(800);
    const got = (await api("GET", `/conversations/${conv}/feedback`)).json;
    if (!JSON.stringify(got).includes('"up"')) throw new Error(JSON.stringify(got));
    return "rating up stored";
  });
  await check("A thumb down opens a note box, and the note is saved with it", async () => {
    await messageRow.hover();
    await page.getByRole("button", { name: "Bad answer" }).first().click();
    const noteForm = page.locator("form", { has: page.getByRole("button", { name: "Save note" }) });
    await noteForm.waitFor();
    const box = noteForm.locator("textarea, .cm-content").first();
    await box.click();
    await page.keyboard.type("It said nine weeks, the policy says nine days.");
    await page.getByRole("button", { name: "Save note" }).click();
    await page.waitForTimeout(1000);
    const got = JSON.stringify((await api("GET", `/conversations/${conv}/feedback`)).json);
    if (!got.includes('"down"') || !got.includes("nine days")) throw new Error(got);
    return "rating down with its note stored";
  });

  // --- Quality tab -------------------------------------------------------------------------------------------------------------------
  await page.goto(`${ORIGIN}/bots/${op.id}/settings?tab=quality`);
  await page.waitForSelector("text=Performance");
  await check("Performance counts the thumb down and the answer", async () => {
    const text = await page.locator("body").innerText();
    const bad = Number(/Bad answers\s*\n\s*(\d+)/.exec(text)?.[1] ?? 0);
    if (bad < 1) throw new Error(text.slice(0, 600));
    return `Bad answers ${bad} (earlier runs of this script add to it)`;
  });
  await check("A saved test is added and listed", async () => {
    const form = page.locator("form", {
      has: page.getByRole("button", { name: "Save this test" }),
    });
    await form.locator("input").first().fill("Shipping time");
    await form.locator("textarea, .cm-content").first().click();
    await page.keyboard.type("How long does shipping take?");
    if (process.env.SHOTS)
      await page.screenshot({ path: `${process.env.SHOTS}/saved-test-typed.png` });
    await form.getByRole("button", { name: "Save this test" }).click();
    await page.waitForSelector("text=Shipping time");
    const list = (await api("GET", `/bots/${op.id}/drive`)).json;
    if (!JSON.stringify(list).includes("Shipping time"))
      throw new Error(JSON.stringify(list).slice(0, 300));
    return "saved test listed on the page and by the API";
  });
  await report.check("A change to the bot shows in History and can be brought back", async () => {
    const current = async () =>
      (
        (await api("GET", "/bots")).json.bots as {
          id: string;
          version: number;
          personality?: string;
        }[]
      ).find((b) => b.id === op.id)!;
    const before = await current();
    const v1 = await api("PATCH", `/bots/${op.id}`, {
      expectedVersion: before.version,
      patch: { personality: "Answer in exactly one word." },
    });
    if (v1.status !== 200)
      throw new Error(`patch ${v1.status} ${JSON.stringify(v1.json).slice(0, 200)}`);
    await page.reload();
    await page.waitForSelector("text=History");
    const bring = page.getByRole("button", { name: "Bring it back" }).first();
    await bring.waitFor();
    await bring.click();
    await page.getByRole("button", { name: "Yes, bring it back" }).click();
    await page.waitForTimeout(1500);
    const after = await current();
    if (after.personality === "Answer in exactly one word.")
      throw new Error("the personality was not restored");
    if (after.version <= v1.json.bot.version) throw new Error("a restore must be a new version");
    return `restored as version ${after.version}`;
  });

  // --- microphone --------------------------------------------------------------------------------------------------------------------
  await report.check(
    "The microphone records, sends 16 kHz samples with the browser language, and puts the words in the box",
    async () => {
      await page.goto(`${ORIGIN}/chat/${conv}`);
      await page.waitForSelector("text=Shipping takes about nine weeks.");
      let seen: { language?: string; bytes: number } | undefined;
      await page.route("**/api/transcribe", async (route) => {
        const body = JSON.parse(route.request().postData() ?? "{}") as {
          pcmBase64?: string;
          language?: string;
        };
        seen = {
          language: body.language,
          bytes: Buffer.from(body.pcmBase64 ?? "", "base64").length,
        };
        await route.fulfill({ json: { text: "remind me about the invoice" } });
      });
      await page.getByRole("button", { name: "Record a message" }).click();
      await page.waitForTimeout(3500);
      await page.getByRole("button", { name: /stop|recording/i }).click();
      await page.waitForFunction(() =>
        document.body.innerText.includes("remind me about the invoice"),
      );
      if (!seen || seen.bytes < 16_000) throw new Error(`request: ${JSON.stringify(seen)}`);
      return `${seen.bytes} bytes (${(seen.bytes / 32_000).toFixed(1)} s), language ${seen.language}`;
    },
  );

  // --- chat memory form ----------------------------------------------------------------------------------------------------------
  await check(
    "The chat memory form checks a typed value, saves it, and History lists it",
    async () => {
      await page.goto(`${ORIGIN}/bots/${op.id}/settings`);
      const form = page.locator("form", {
        has: page.getByRole("button", { name: "Save chat memory" }),
      });
      await form.waitFor();
      await form.locator('[name="contextBytes"]').fill("70000");
      await page.waitForSelector("text=must be between 4,000 and 60,000");
      if (!(await form.getByRole("button", { name: "Save chat memory" }).isDisabled()))
        throw new Error("Save must stay off for a value out of range");
      await form.locator('[name="contextBytes"]').fill("33,000");
      await form.locator('[name="summaryMode"]').selectOption("bot");
      await form.locator('[name="summaryMaxChars"]').fill("4000");
      await form.locator('[name="summaryGapBytes"]').fill("9000");
      await form.locator('[name="chatSearchLimit"]').fill("4");
      await form.getByRole("button", { name: "Save chat memory" }).click();
      await page.waitForTimeout(1200);
      const mine = ((await api("GET", "/bots")).json.bots as Record<string, unknown>[]).find(
        (b) => b.id === op.id,
      )!;
      for (const [k, v] of Object.entries({
        contextBytes: 33_000,
        summaryMode: "bot",
        summaryMaxChars: 4000,
        summaryGapBytes: 9000,
        chatSearchLimit: 4,
      }))
        if (mine[k] !== v) throw new Error(`${k} is ${String(mine[k])}, expected ${String(v)}`);
      await page.goto(`${ORIGIN}/bots/${op.id}/settings?tab=quality`);
      await page.waitForSelector("text=History");
      const text = await page.locator("body").innerText();
      if (!/summary of older messages/.test(text))
        throw new Error("History does not list the summary setting");
      // Back to the defaults through the form.
      await page.goto(`${ORIGIN}/bots/${op.id}/settings`);
      const again = page.locator("form", {
        has: page.getByRole("button", { name: "Save chat memory" }),
      });
      await again.getByRole("button", { name: "Use the defaults" }).click();
      await again.getByRole("button", { name: "Save chat memory" }).click();
      await page.waitForTimeout(1200);
      const reset = ((await api("GET", "/bots")).json.bots as Record<string, unknown>[]).find(
        (b) => b.id === op.id,
      )!;
      if (reset.contextBytes !== null || reset.summaryMode !== "chief")
        throw new Error("the defaults were not restored");
      return "typed 33,000 / bot / 4,000 / 9,000 / 4 saved, listed in History, and reset to the defaults";
    },
  );

  // --- speech-to-text provider ---------------------------------------------------------------------------------------------------
  const KEY = "sk-test-demo-0123456789abcdef";
  const providerSaw: { auth: string | null; model: string; language: string | null }[] = [];
  const provider = Bun.serve({
    port: 0,
    async fetch(req) {
      const form = await req.formData();
      providerSaw.push({
        auth: req.headers.get("authorization"),
        model: String(form.get("model")),
        language: form.get("language") === null ? null : String(form.get("language")),
      });
      return Response.json({ text: "a fake transcript" });
    },
  });
  try {
    await check(
      "The speech-to-text settings: a provider, a sealed key that is never shown again, and a test that works",
      async () => {
        await page.goto(`${ORIGIN}/studio/voice`);
        const form = page.locator('form[aria-label="Speech to text"]');
        await form.waitFor();
        await form.locator('[name="transcribeProvider"]').selectOption("compatible");
        await form
          .locator('[name="transcribeBaseUrl"]')
          .fill(`http://127.0.0.1:${provider.port}/v1`);
        await form.locator('[name="transcribeModel"]').fill("fake-whisper");
        await form.locator('[name="transcribeLanguage"]').fill("pt");
        const privacy = await form.innerText();
        if (!privacy.includes(`sent to 127.0.0.1:${provider.port}`))
          throw new Error(`no privacy sentence: ${privacy.slice(0, 300)}`);
        await form.getByRole("button", { name: /^Save: recordings go to/ }).click();
        await page.waitForSelector("text=Saved.");
        await form.locator('[name="transcribeKey"]').fill(KEY);
        await form.getByRole("button", { name: "Save key" }).click();
        await page.waitForSelector("text=Key saved. It is stored encrypted");
        if ((await form.locator('[name="transcribeKey"]').inputValue()) !== "")
          throw new Error("the key field was not cleared");
        const shown = await page.locator("body").innerText();
        if (shown.includes(KEY)) throw new Error("the key is on the page");
        const inst = JSON.stringify((await api("GET", "/installation")).json);
        if (inst.includes(KEY) || inst.includes("transcribeConnectionId"))
          throw new Error(`the installation leaks: ${inst.slice(0, 300)}`);
        if (!inst.includes('"transcribeKey":"set"'))
          throw new Error(`the key is not reported as set: ${inst.slice(0, 300)}`);
        await form.getByRole("button", { name: "Test" }).click();
        await page.waitForSelector("text=It works");
        const saw = providerSaw.at(-1);
        if (saw?.auth !== `Bearer ${KEY}` || saw.model !== "fake-whisper" || saw.language !== "pt")
          throw new Error(`the provider saw ${JSON.stringify(saw)}`);
        return "provider, address, model and language saved; the key sealed, cleared from the field and never returned; Test reached the provider with the key";
      },
    );

    await check(
      "The microphone's route uses the chosen provider with the browser's language, and a removed key says so",
      async () => {
        // The microphone check stubbed this route; here the real one is wanted.
        await page.unroute("**/api/transcribe");
        const pcm = Buffer.alloc(32_000).toString("base64");
        const done = await api("POST", "/transcribe", { pcmBase64: pcm, language: "fr-CA" });
        if (done.json.text !== "a fake transcript")
          throw new Error(`transcribe: ${done.status} ${JSON.stringify(done.json).slice(0, 200)}`);
        if (providerSaw.at(-1)?.language !== "fr")
          throw new Error(`language ${String(providerSaw.at(-1)?.language)}`);
        await page.goto(`${ORIGIN}/studio/voice`);
        const form = page.locator('form[aria-label="Speech to text"]');
        await form.waitFor();
        await form.getByRole("button", { name: "Remove key" }).click();
        await page.waitForSelector("text=Key removed.");
        const gone = await api("POST", "/transcribe", { pcmBase64: pcm });
        if (!JSON.stringify(gone.json).includes("API key for speech to text is not available"))
          throw new Error(`no key: ${JSON.stringify(gone.json).slice(0, 200)}`);
        // Back to the server's own model, so the demo stack is left as it was found.
        await form.locator('[name="transcribeProvider"]').selectOption("local");
        await form.getByRole("button", { name: "Save", exact: true }).click();
        await page.waitForSelector("text=Saved.");
        return "the route followed the provider and the browser's language (fr); with no key it said so, in a fixed sentence";
      },
    );
  } finally {
    provider.stop(true);
  }

  // --- workflow with the new steps ---------------------------------------------------------------------------------------------------
  await check(
    "A workflow with a loop and an approval shows on the canvas and stops at a waiting run",
    async () => {
      const graph = {
        start: "each",
        nodes: {
          each: { type: "for_each", items: "lines", body: "ask", next: "gate", max: 3 },
          ask: { type: "prompt", botId: op.id, template: "Say hi to {{item}}", next: "ask_end" },
          ask_end: { type: "item_end" },
          gate: { type: "approval", message: "Send the greetings?", next: "pause" },
          pause: { type: "wait", seconds: 3600, next: "done" },
          done: { type: "end" },
        },
      };
      const name = `Greetings with a gate ${Date.now().toString(36)}`;
      const saved = await api("POST", "/workflows", { name, graph });
      if (saved.status !== 201)
        throw new Error(`save ${saved.status} ${JSON.stringify(saved.json).slice(0, 300)}`);
      await page.goto(`${ORIGIN}/studio/workflows`);
      const row = page
        .locator("div", { hasText: name })
        .filter({ has: page.getByRole("button", { name: "Canvas" }) })
        .last();
      await row.getByRole("button", { name: "Canvas" }).click();
      await page.waitForTimeout(2500);
      const text = await page.locator("body").innerText();
      for (const word of [/For each item/, /Ask me first/, /Wait/, /End of item/])
        if (!word.test(text))
          throw new Error(`the canvas does not show ${word}: ${text.slice(0, 400)}`);
      await page.screenshot({ path: "docs/verification/e2e/ui-workflow-canvas.png" });
      // A run with nothing to loop over goes straight to the approval step: it must stop there as "waiting", with a card for the person.
      const run = await api("POST", `/workflows/${saved.json.workflow.id}/run`, { input: "" });
      if (run.json.run?.status !== "waiting")
        throw new Error(`run: ${JSON.stringify(run.json).slice(0, 300)}`);
      // The pause is a card for the person: it exists, is still open, and belongs to this run.
      const card = await sql(
        `select p.kind || ' ' || p.status from zetta.config_proposal p join zetta.workflow_run r on r.pending_proposal_id = p.id where r.id = '${run.json.run.id}'`,
      );
      if (card !== "chief_action pending") throw new Error(`the approval card is "${card}"`);
      const cancelled = await api("POST", `/workflow-runs/${run.json.run.id}/cancel`);
      return `loop, approval and wait steps shown; a run stopped at the approval (waiting), its card is ${card}; cancel ${cancelled.status}`;
    },
  );
} finally {
  await browser.close();
}
report.note(
  "Speech to text is faked in this script (the words come back from a stub); the real model is checked in voice.md.",
);
report.note(
  "The reply the thumbs rate was written into the demo database by this script: no model answered it.",
);
process.exit(report.finish("the demo stack and Playwright's Chromium"));
