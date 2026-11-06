// What the stand-in `claude` (bin/claude) answers for the bots of the landing page recordings (record.ts routines | chats).
// Same rule format as replies.ts: `req` is matched against the person's message, `steps` is the number of tool calls already made.
import type { Rule } from "./replies.ts";

const block = (kind: string, body: Record<string, unknown>) =>
  `\`\`\`zetta:${kind}\n${JSON.stringify(body)}\n\`\`\``;

export const landingRules: Rule[] = [
  // The Friday newsletter: a chat and the routine that runs it ask for the same thing.
  {
    req: "Friday newsletter",
    steps: 0,
    reply: [
      "I collected 9 updates from the changelog and the team room, grouped them into **Shipped**, **In progress** and **Next week**, and checked every link.",
      "**Subject:** What shipped this week",
      "- Routines can now run on weekdays only\n- Inbox shows what is blocked first\n- Faster search in memory",
      "The draft is ready. Sending mail needs your approval: **send it to the whole team list?**",
    ].join("\n\n"),
  },
  // The morning briefing routine.
  {
    req: "morning briefing",
    steps: 0,
    reply: [
      "Good morning. Three things from the sources, newest first:",
      "1. The payments pull request has two open comments.\n2. The newsletter draft is ready for your OK.\n3. Nothing new in the weekly brief channel.",
    ].join("\n\n"),
  },
  // The pull request queue routine.
  {
    req: "open pull requests of the payments team",
    steps: 0,
    reply: [
      "I went through the queue, payments first:",
      "- **#412** retry on failed charges: approve after one rename.\n- **#418** refund email: needs a test.\n- **#421** authentication: blocked, I cannot read the next files.",
    ].join("\n\n"),
  },
  // Approval: the Writer is asked to send the newsletter and needs the mail rule, so it asks the Chief.
  {
    req: "send the newsletter to the team list",
    steps: 0,
    reply: [
      "Sending mail needs your approval. I will ask the Chief for the rule.",
      block("permission", {
        rule: "Bash(mail:*)",
        reason: "Send the Friday newsletter to the whole team list.",
      }),
    ].join("\n"),
  },
  {
    req: "send the newsletter to the team list",
    steps: 1,
    reply: "I asked the Chief to let me send mail. I stop here until you approve it.",
  },
];
