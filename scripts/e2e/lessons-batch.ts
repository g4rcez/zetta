// The daily reading of a bot's chats with a real model: one rule said outright, one correction made in two chats, and one passing remark.
// What must come back: the first two on trial with quotes that really are in the owner's messages, and nothing for the remark.
// Costs one small model call on the account the Claude CLI is signed in to.
//   bun scripts/e2e/lessons-batch.ts
import { uuidv7 } from "../../packages/core/src/uuid";
import { and, eq, inArray } from "../../packages/db/src/query";
import { user } from "../../packages/db/src/schema/auth";
import { bot, conversation, message } from "../../packages/db/src/schema/chat";
import { membership } from "../../packages/db/src/schema/identity";
import { botLesson, botLessonEvidence, learningRun } from "../../packages/db/src/schema/learning";
import { runCli } from "../../apps/server/src/modules/chat/harness";
import { createBatch } from "../../apps/server/src/modules/learning/batch";
import { createLessons } from "../../apps/server/src/modules/learning/lessons";
import { createMemory } from "../../apps/server/src/modules/memory/service";
import { throwawayDb } from "./db";
import { createReport } from "./report";

const report = createReport(
  "lessons-batch",
  "Lessons: the daily reading of a bot's chats, with a real model",
);
if (!Bun.which("claude")) {
  report.skip("Claude CLI", "`claude` is not installed on this machine");
  process.exit(report.finish("the Claude CLI installed and signed in"));
}

const { db, stop } = await throwawayDb();
const A = `e2e-lessons-${uuidv7()}`;
try {
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
  const [chief] = await db
    .insert(bot)
    .values({
      ownerUserId: A,
      kind: "chief",
      visibility: "private",
      name: "Chief",
      slug: `chief-${uuidv7().slice(-10)}`,
      harness: "claude-code",
      model: "haiku",
    } as never)
    .returning();
  const [worker] = await db
    .insert(bot)
    .values({
      ownerUserId: A,
      kind: "specialist",
      visibility: "private",
      name: "Support helper",
      slug: `helper-${uuidv7().slice(-10)}`,
      harness: "claude-code",
      model: "haiku",
      autoLearn: "auto",
    } as never)
    .returning();
  let seq = 0;
  let minutes = 55; // every message was written in the last hour, and none in the last ten minutes (the reading waits for a quiet chat)
  const chat = async (lines: { role: "user" | "assistant"; content: string }[]) => {
    const [c] = await db
      .insert(conversation)
      .values({ ownerUserId: A, botId: worker!.id, title: "t" } as never)
      .returning();
    for (const l of lines)
      await db.insert(message).values({
        conversationId: c!.id,
        ownerUserId: A,
        seq: ++seq,
        role: l.role,
        content: l.content,
        status: "complete",
        ...(l.role === "assistant" ? { botId: worker!.id } : {}),
        createdAt: new Date(Date.now() - minutes-- * 60_000),
      } as never);
  };
  await chat([
    { role: "user", content: "A customer asks how long refunds take. What do I tell them?" },
    {
      role: "assistant",
      content:
        "Refunds usually take five to seven business days after we approve them. The time depends on the customer's bank, and some banks are slower around holidays. You can also point them to our refunds page for the full policy and the steps to follow.",
    },
    {
      role: "user",
      content: "Too long. From now on, always answer refund questions in a single line.",
    },
    { role: "assistant", content: "Understood: refunds take 5 to 7 business days." },
  ]);
  await chat([
    { role: "user", content: "Summarise this month's tickets by category." },
    { role: "assistant", content: "Billing 41, login 28, shipping 19, other 12." },
    { role: "user", content: "Please put the monthly report in a table instead of a list." },
    { role: "assistant", content: "| Category | Tickets |\n| --- | --- |\n| Billing | 41 |" },
  ]);
  await chat([
    { role: "user", content: "Now the quarterly numbers for the same categories." },
    { role: "assistant", content: "Q3: billing 120, login 80, shipping 61, other 33." },
    { role: "user", content: "Again as a table, like the monthly report. Reports go in tables." },
    { role: "assistant", content: "| Category | Q3 |\n| --- | --- |\n| Billing | 120 |" },
  ]);
  await chat([
    { role: "user", content: "Draft a thank-you e-mail to the customer who wrote in today." },
    { role: "assistant", content: "Dear customer, thank you for writing to us..." },
    { role: "user", content: "For this one e-mail only, sign it Marta." },
    { role: "assistant", content: "Signed: Marta." },
  ]);

  const memory = createMemory(db);
  const lessons = createLessons(db, { memory });
  const batch = createBatch(db, { lessons, cli: runCli });
  let outcome: Awaited<ReturnType<typeof batch.runNow>> | undefined;
  const started = Date.now();
  await report.check("the reading runs with the real engine and finishes", async () => {
    outcome = await batch.runNow(A, worker!.id);
    const run = await outcome.done;
    if (run.status !== "done")
      throw new Error(`the reading ended as "${run.status}": ${run.detail}`);
    return `took ${((Date.now() - started) / 1000).toFixed(0)} s; ${run.candidates} candidates, ${run.promoted} started`;
  });
  if (!outcome) process.exit(report.finish("the Claude CLI installed and signed in"));

  const all = await db.select().from(botLesson).where(eq(botLesson.botId, worker!.id));
  const onTrial = all.filter((l) => l.status === "trial");
  const evidence = await db
    .select()
    .from(botLessonEvidence)
    .where(
      inArray(
        botLessonEvidence.lessonId,
        all.map((l) => l.id),
      ),
    );
  const owners = (
    await db
      .select({ content: message.content })
      .from(message)
      .where(and(eq(message.ownerUserId, A), eq(message.role, "user")))
  ).map((m) => m.content);

  await report.check(
    "the rule the person said outright is on trial, said and not guessed",
    async () => {
      const l = onTrial.find((x) => /(single|one)[ -]line|one sentence/i.test(x.text));
      if (!l)
        throw new Error(
          `no lesson about single-line refund answers is on trial: ${all.map((x) => `${x.status}: ${x.text}`).join(" | ")}`,
        );
      if (l.basis !== "said") throw new Error(`its basis is "${l.basis}", not "said"`);
      return `"${l.text}"`;
    },
  );
  await report.check("the correction made in two chats is on trial", async () => {
    const l = onTrial.find((x) => /table/i.test(x.text));
    if (!l)
      throw new Error(
        `no lesson about tables is on trial: ${all.map((x) => `${x.status}: ${x.text}`).join(" | ")}`,
      );
    return `"${l.text}" (${l.basis})`;
  });
  await report.check("a passing remark said once is not on trial", async () => {
    const l = onTrial.find((x) => /marta/i.test(x.text));
    if (l) throw new Error(`the one-off sign-off became a lesson: "${l.text}"`);
  });
  await report.check(
    "every quote kept as evidence is really in a message the owner wrote",
    async () => {
      if (!evidence.length) throw new Error("no evidence was kept");
      const missing = evidence.filter((e) => !owners.some((o) => o.includes(e.quote)));
      if (missing.length)
        throw new Error(
          `quotes not found word for word: ${missing.map((e) => e.quote).join(" | ")}`,
        );
      return `${evidence.length} quotes, all found`;
    },
  );
  await report.check("the reading is recorded, with its window", async () => {
    const [run] = await db.select().from(learningRun).where(eq(learningRun.botId, worker!.id));
    if (!run) throw new Error("no learning_run row");
    return `status ${run.status}, ${run.candidates} candidates, ${run.promoted} started`;
  });
  void chief;
} finally {
  await stop();
}
process.exit(report.finish("the Claude CLI installed and signed in"));
