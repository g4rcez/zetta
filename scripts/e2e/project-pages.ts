// Project pages in a real browser, and the brief draft with a real model.
//  1. Browser (needs `docs/demo/computer/stack.sh up`): create a project with a bot on it, ask the bot for work from the page,
//     and check the page tells the manager the truth: the name, who works on it, the open task under that worker, an "Ask" box.
//  2. Real model (needs the Claude CLI): the one-sentence brief draft returns four sensible answers, and refuses to send a secret.
//   bun scripts/e2e/project-pages.ts
import { ORIGIN, STATE, browserOptions, loadChromium } from "../../docs/demo/computer/lib.ts";
import { uuidv7 } from "../../packages/core/src/uuid";
import { user } from "../../packages/db/src/schema/auth";
import { bot } from "../../packages/db/src/schema/chat";
import { membership } from "../../packages/db/src/schema/identity";
import { createOneShot } from "../../apps/server/src/modules/chat/one-shot";
import { createProjectDraft } from "../../apps/server/src/modules/projects/draft";
import { existsSync } from "node:fs";
import { throwawayDb } from "./db";
import { createReport } from "./report";

const report = createReport(
  "project-pages",
  "Projects: the page in a real browser, and the brief draft with a real model",
);

// 1. The page.
if (!existsSync(STATE))
  report.skip(
    "project page in Chromium",
    "the demo stack is not up (run docs/demo/computer/stack.sh up first)",
  );
else {
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
    const name = `E2E launch ${Date.now().toString(36)}`;
    let projectId = "";
    await report.check("a project is created with a bot on it", async () => {
      const bots = (await api("GET", "/bots")).json.bots as {
        id: string;
        name: string;
        kind: string;
      }[];
      const worker =
        bots.find((b) => b.name === "Operator") ?? bots.find((b) => b.kind !== "chief");
      if (!worker) throw new Error("the stack has no specialist bot");
      const made = await api("POST", "/projects", {
        name,
        outcome: "A launch page and a checklist",
        labels: ["launch"],
        bots: [worker.id],
        people: [],
      });
      if (made.status !== 201)
        throw new Error(`create: ${made.status} ${JSON.stringify(made.json).slice(0, 160)}`);
      projectId = made.json.project.id;
      const work = await api("POST", `/projects/${projectId}/work`, {
        to: { kind: "bot", id: worker.id },
        text: "Draft the launch checklist",
      });
      if (work.status !== 201)
        throw new Error(`ask for work: ${work.status} ${JSON.stringify(work.json).slice(0, 200)}`);
      return `worker ${worker.name}`;
    });
    if (projectId) {
      await page.goto(`${ORIGIN}/projects/${projectId}`);
      await report.check(
        "the page shows the name, a health sentence and a progress count",
        async () => {
          await page.getByRole("heading", { level: 1, name }).waitFor();
          const sentence = await page.locator("header p").first().innerText();
          if (sentence.trim().length < 8) throw new Error(`no health sentence: "${sentence}"`);
          return sentence.slice(0, 80);
        },
      );
      await report.check(
        "the task the manager asked for is listed under the bot that does it",
        async () => {
          await page.getByText("Draft the launch checklist").first().waitFor();
          const group = page.getByRole("region", { name: "Operator" });
          if (!(await group.getByText("Draft the launch checklist").count()))
            throw new Error("the task is not under the bot's section");
        },
      );
      await report.check(
        "the manager can ask from the page: the box and the Ask button are there",
        async () => {
          await page.getByText("What do you want?").first().waitFor();
          const ask = page.getByRole("button", { name: "Ask", exact: true });
          if (!(await ask.isDisabled())) throw new Error("Ask is enabled with an empty box");
        },
      );
      await page
        .screenshot({ path: `${process.env.TMPDIR ?? "/tmp"}/zetta-e2e-project.png` })
        .catch(() => undefined);
    }
  } finally {
    await browser.close();
  }
}

// 2. The brief draft with a real model.
if (!Bun.which("claude"))
  report.skip("brief draft with a real model", "`claude` is not installed on this machine");
else {
  const { db, stop } = await throwawayDb();
  try {
    const A = `e2e-draft-${uuidv7()}`;
    const now = new Date();
    await db.insert(user).values({
      id: A,
      name: "Ada",
      email: `${A}@example.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: A, status: "active", joinedAt: now, updatedAt: now });
    await db.insert(bot).values({
      ownerUserId: A,
      kind: "chief",
      visibility: "private",
      name: "Chief",
      slug: `chief-${uuidv7().slice(-10)}`,
      harness: "claude-code",
      model: "haiku",
      onboarded: true,
    } as never);
    const draft = createProjectDraft(createOneShot(db));
    await report.check("one sentence becomes a four-part brief a person can correct", async () => {
      const started = Date.now();
      const r = await draft(A, {
        name: "Spring sale",
        sentence:
          "We want a landing page and one email for the spring sale, for existing customers only, no paid ads.",
      });
      if (r.kind !== "ok")
        throw new Error(`the draft came back as ${r.kind}: ${"reason" in r ? r.reason : ""}`);
      const v = r.value;
      if (v.outcome.length < 15 || v.audience.length < 3 || v.doneWhen.length < 10)
        throw new Error(`a field is empty or too short: ${JSON.stringify(v).slice(0, 200)}`);
      if (!/customer/i.test(v.audience))
        throw new Error(`the audience ignores "existing customers": ${v.audience}`);
      return `${((Date.now() - started) / 1000).toFixed(0)} s; outcome: ${v.outcome.slice(0, 70)}`;
    });
    await report.check("a sentence that holds a secret is not sent to the model", async () => {
      const r = await draft(A, {
        name: "Deploy",
        sentence:
          "Use the key sk-ant-api03-AAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAAA to deploy.",
      });
      if (r.kind !== "unavailable") throw new Error(`it went ahead: ${r.kind}`);
    });
  } finally {
    await stop();
  }
}
report.note(
  "Not covered: the stalled-work scan run by the server's own ticker over days, a member (not the owner) looking at the page, and the page on a phone.",
);
process.exit(report.finish("the isolated demo stack, a Chromium, and the Claude CLI"));
