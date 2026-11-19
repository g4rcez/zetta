// Fluid chat with a real model, through the real chat service (docs/decisions/fluid-chat.md): what a person sends while a bot works
// reaches the bot while it works. Three chats with a Claude Code bot on a throwaway database:
//   1. five short messages in a row get one answer that reflects all five, the correction included;
//   2. a correction sent during a long command is read when the command ends, and the command is not cut;
//   3. Stop while a message is still unread ends the reply and nothing answers that message.
// Real calls: three short runs on a cheap model, on the account the Claude CLI is signed in to.
//   bun scripts/e2e/fluid-chat.ts
import { mkdtempSync, rmSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { uuidv7 } from "../../packages/core/src/uuid";
import { asc, eq } from "../../packages/db/src/query";
import { user } from "../../packages/db/src/schema/auth";
import { bot, chatQueue, message } from "../../packages/db/src/schema/chat";
import { membership } from "../../packages/db/src/schema/identity";
import { createIdentityAccess } from "../../apps/server/src/modules/identity/access";
import { codeDir } from "../../apps/server/src/modules/chat/harness";
import { createTurnRunner } from "../../apps/server/src/modules/chat/pipeline";
import { createChatService } from "../../apps/server/src/modules/chat/service";
import { throwawayDb } from "./db";
import { createReport } from "./report";

const report = createReport(
  "fluid-chat",
  "Fluid chat: messages sent while a bot works, with a real model",
);
if (!Bun.which("claude")) {
  report.skip("Claude CLI", "`claude` is not installed on this machine");
  process.exit(report.finish("the Claude CLI installed and signed in"));
}

// The bot's commands run in a folder of this script's own, never in the person's code directory.
const state = mkdtempSync(join(tmpdir(), "zetta-fluid-"));
process.env.ZETTA_CODE_ROOT = join(state, "code");
process.env.ZETTA_CLAUDE_PLUGIN_ROOT = join(state, "plugins");
delete process.env.ZETTA_CODE_ACCESS;

const { db, stop } = await throwawayDb();
const A = `e2e-fluid-${uuidv7()}`;
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
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
  const access = createIdentityAccess(
    {
      api: {
        async getSession({ headers }) {
          const id = headers.get("x-test-user");
          return id ? { user: { id } } : null;
        },
      },
    },
    async () => ({ isAdmin: false }),
  );
  const actor = await access.requireActive(new Headers({ "x-test-user": A }));
  const chat = createChatService(
    db,
    createTurnRunner(db),
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    undefined,
    { backgroundActor: (id) => access.requireActive(new Headers({ "x-test-user": id })) },
  );

  const newChat = async () => {
    const [b] = await db
      .insert(bot)
      .values({
        ownerUserId: A,
        kind: "specialist",
        visibility: "private",
        name: `Helper ${uuidv7().slice(-6)}`,
        slug: `helper-${uuidv7().slice(-10)}`,
        harness: "claude-code",
        model: "haiku",
        onboarded: true,
        instructions: "Follow the user's instructions exactly. Keep every reply short.",
      } as never)
      .returning();
    return (await chat.createConversation(actor, b!.id))!.id;
  };
  const rows = (c: string) =>
    db.select().from(message).where(eq(message.conversationId, c)).orderBy(asc(message.seq));
  const queued = (c: string) => db.select().from(chatQueue).where(eq(chatQueue.conversationId, c));
  /** Waits until no reply runs in the chat and nothing waits, then returns its messages. */
  const settled = async (c: string, ms = 240_000) => {
    const deadline = Date.now() + ms;
    for (;;) {
      const all = await rows(c);
      if (!all.some((m) => m.status === "running") && !(await queued(c)).length) return all;
      if (Date.now() > deadline) throw new Error("the chat did not settle in time");
      await sleep(500);
    }
  };
  const say = (c: string, content: string) =>
    chat.enqueue(actor, c, { content, clientRequestId: uuidv7() });
  const readBy = (m: { meta: unknown }) =>
    (m.meta as { steer?: { replyId?: string } } | null)?.steer?.replyId;
  // How long after a turn starts the bot is inside its first command: the CLI needs a few seconds to start and to call the
  // model, and the commands below run for 15 s or more. (The saved steps are not used for this: they are written every few seconds.)
  const INSIDE_THE_COMMAND_MS = 8000;

  await report.check("five messages in a row get one answer that reflects all five", async () => {
    const c = await newChat();
    const started = Date.now();
    await chat.startTurn(actor, c, {
      content:
        "I will send you a few words, one per message. When I say that is all, answer with one line holding every word, in capitals, separated by commas. First word: apple",
    });
    for (const text of [
      "banana",
      "cherry",
      "actually replace banana with mango",
      "that is all, answer now",
    ]) {
      await sleep(1500);
      await say(c, text);
    }
    const all = await settled(c);
    const replies = all.filter((m) => m.role === "assistant");
    const people = all.filter((m) => m.role === "user");
    if (replies.length !== 1)
      throw new Error(
        `${replies.length} replies: ${replies.map((r) => r.content.slice(0, 60)).join(" | ")}`,
      );
    const reply = replies[0]!;
    if (reply.status !== "complete") throw new Error(`the reply ended as ${reply.status}`);
    // The words are asked for in capitals, so only the final answer has them that way; the replaced word must not be there.
    const said = reply.content.replace(/\s+/g, " ").trim();
    if (!/APPLE/.test(said) || !/MANGO/.test(said) || !/CHERRY/.test(said) || /BANANA/.test(said))
      throw new Error(`the answer does not reflect all five: ${said.slice(0, 200)}`);
    // One answer, not an answer to the first messages followed by another.
    if (/next word|that is all/i.test(said))
      throw new Error(`the bot answered before it had every message: ${said.slice(0, 200)}`);
    if (all.at(-1)!.id !== reply.id)
      throw new Error("the answer is not the last thing in the chat");
    const unread = people.slice(1).filter((m) => readBy(m) !== reply.id);
    if (unread.length)
      throw new Error(`${unread.length} message(s) carry no read mark of the reply`);
    return `one reply after ${((Date.now() - started) / 1000).toFixed(0)} s: ${said.slice(0, 120)}`;
  });

  await report.check(
    "a correction sent during a long command is read when the command ends",
    async () => {
      const c = await newChat();
      const started = Date.now();
      await chat.startTurn(actor, c, {
        content:
          "Do this in order with the Bash tool. Step 1: run exactly `sleep 15 && echo slept-ok` in the foreground and wait for it. Step 2: write the single word LEFT into a file named out.txt in the current directory. Then tell me which word you wrote.",
      });
      await sleep(INSIDE_THE_COMMAND_MS);
      // The check is about a bot that is still working: if it already answered, there is nothing to correct mid-run.
      if (!(await chat.isBusy(actor, c)))
        throw new Error("the bot had already answered when the correction was sent");
      await say(c, "Correction: write RIGHT instead of LEFT.");
      const sentAt = Date.now() - started;
      const all = await settled(c);
      const replies = all.filter((m) => m.role === "assistant");
      if (replies.length !== 1 || replies[0]!.status !== "complete")
        throw new Error(`replies: ${replies.map((r) => r.status).join(", ")}`);
      const reply = replies[0]!;
      const note = all.find((m) => m.content.startsWith("Correction:"))!;
      if (readBy(note) !== reply.id)
        throw new Error("the correction carries no read mark of the reply");
      if (all.at(-1)!.id !== reply.id) throw new Error("the answer is not below the correction");
      const steps = ((reply.meta as { timeline?: { label: string }[] } | null)?.timeline ?? []).map(
        (s) => s.label,
      );
      const file = await readFile(join(codeDir(A), "out.txt"), "utf8").catch(() => "(no file)");
      if (!/RIGHT/.test(file) || /LEFT/.test(file))
        throw new Error(
          `out.txt holds: ${file.trim().slice(0, 60)}; reply: ${reply.content.slice(0, 100)}`,
        );
      // The command was running when the message arrived and the whole turn outlasted it: it was not cut.
      const took = (Date.now() - started) / 1000;
      if (took < 15)
        throw new Error(`the turn ended after ${took.toFixed(0)} s, before the command could end`);
      return `correction sent ${(sentAt / 1000).toFixed(0)} s in, turn took ${took.toFixed(0)} s, ${steps.length} steps, out.txt = ${file.trim()}; reply: ${reply.content.trim().slice(0, 70)}`;
    },
  );

  await report.check(
    "Stop with an unread message ends the reply and nothing answers the message",
    async () => {
      const c = await newChat();
      await chat.startTurn(actor, c, {
        // Not `sleep 45`: the CLI refuses a long sleep in the foreground and runs it in the background, which frees the bot at once.
        content:
          "Run exactly this with the Bash tool, in the foreground, and wait for it: `python3 -c \"import time; time.sleep(45); print('done')\"`. Then say DONE.",
      });
      await sleep(INSIDE_THE_COMMAND_MS);
      await say(c, "Also tell me a joke.");
      await sleep(1500);
      const sent = (await rows(c)).find((m) => m.content === "Also tell me a joke.");
      if (sent && readBy(sent))
        throw new Error(
          "the bot read the message before Stop: its command was not running in the foreground",
        );
      await chat.cancelTurn(actor, c);
      const all = await settled(c, 60_000);
      // Nothing starts behind the person's back.
      await sleep(6000);
      const later = await rows(c);
      const replies = later.filter((m) => m.role === "assistant");
      if (replies.length !== 1 || replies[0]!.status !== "cancelled")
        throw new Error(`replies: ${replies.map((r) => r.status).join(", ")}`);
      const joke = later.find((m) => m.content === "Also tell me a joke.");
      if (!joke) throw new Error("the unread message is gone");
      if (readBy(joke)) throw new Error("the unread message is marked as read");
      if ((await queued(c)).length) throw new Error("a queue row is left");
      return `reply ${replies[0]!.status}; the message stays, unread, with ${all.length} messages in the chat`;
    },
  );
} catch (e) {
  report.fail("run", e instanceof Error ? e.message : String(e));
} finally {
  await stop();
  rmSync(state, { recursive: true, force: true });
}
process.exit(
  report.finish("the Claude CLI installed and signed in, the embedded Postgres runtime"),
);
