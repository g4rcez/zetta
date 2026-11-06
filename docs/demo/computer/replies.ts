// What the stand-in `claude` (bin/claude) answers for the bot "Operator" in the computer demos.
//
// A rule fires when its `req` matches the person's message and `steps` is the number of tool calls already made in this turn. The server
// runs the blocks in a reply and then asks again, so one message is several rounds. Placeholders: `{{n:words}}` is the number of the first
// element on the last screen read that has those words, and `{{vm:Name}}` is the id of the computer with that name.

import { landingRules } from "./landing-replies.ts";
import { teamRules } from "./team-replies.ts";

export type Rule = { req: string; steps: number; reply: string };

const desktop = (a: Record<string, unknown>) => `\`\`\`zetta:desktop\n${JSON.stringify(a)}\n\`\`\``;
const reply = (text: string, ...blocks: string[]) => [text, ...blocks].join("\n");
const readScreen = (vm?: string) => desktop({ action: "read", ...(vm ? { vm } : {}) });

/** The shell commands both machines run. They are typed as keys into a terminal, so every command ends with Return. */
const commands = (vm?: string) =>
  ["uname -a", "grep PRETTY_NAME /etc/os-release"].flatMap((text) => [
    desktop({ action: "type", text, ...(vm ? { vm } : {}) }),
    desktop({ action: "key", key: "Return", ...(vm ? { vm } : {}) }),
  ]);

const computerRules: Rule[] = [
  // The person filled in the sign-in form and handed the computer back (listed first: this message also holds the earlier request).
  {
    req: "handed the computer back",
    steps: 0,
    reply: reply("Thanks. I'll look at the page again.", readScreen()),
  },
  {
    req: "handed the computer back",
    steps: 1,
    reply:
      "The sign-in form is filled in. I stop here: I never saw what you typed, and sending the form is your call.",
  },

  // Browse: read a page, follow a link, open a sign-in page, then ask the person to take over.
  {
    req: "GitHub sign-in",
    steps: 0,
    reply: reply(
      "I'll open example.com and read it.",
      desktop({ action: "navigate", url: "https://example.com" }),
      readScreen(),
    ),
  },
  {
    req: "GitHub sign-in",
    steps: 2,
    reply: reply(
      "The page is short. I'll scroll to check that there is nothing below.",
      desktop({ action: "scroll", direction: "down" }),
      readScreen(),
    ),
  },
  {
    req: "GitHub sign-in",
    steps: 4,
    reply: reply(
      "There is a link to more information. I'll follow it.",
      `\`\`\`zetta:desktop\n{"action":"click_element","n":{{n:Learn more|More information}}}\n\`\`\``,
      readScreen(),
    ),
  },
  {
    req: "GitHub sign-in",
    steps: 6,
    reply: reply(
      "Now the GitHub sign-in page.",
      desktop({ action: "navigate", url: "https://github.com/login" }),
      readScreen(),
    ),
  },
  {
    req: "GitHub sign-in",
    steps: 8,
    reply: reply(
      "The GitHub sign-in page is open. I do not type passwords myself. Please take over, fill in the form, and hand the computer back.",
      `\`\`\`zetta:handoff\n${JSON.stringify({ reason: "The sign-in needs your username and password" })}\n\`\`\``,
    ),
  },

  // Machines: a terminal on the default computer, then on Ubuntu.
  {
    req: "uname",
    steps: 0,
    reply: reply(
      "I'll open a terminal on your default computer.",
      desktop({ action: "launch", app: "xfce4-terminal" }),
      readScreen(),
    ),
  },
  {
    req: "uname",
    steps: 2,
    reply: reply("The terminal is open. I'll run both commands.", ...commands(), readScreen()),
  },
  {
    req: "uname",
    steps: 7,
    reply: reply(
      "Now the same on Ubuntu.",
      desktop({ action: "launch", app: "xfce4-terminal", vm: "{{vm:Ubuntu}}" }),
      readScreen("{{vm:Ubuntu}}"),
    ),
  },
  {
    req: "uname",
    steps: 9,
    reply: reply(
      "The terminal is open on Ubuntu. I'll run both commands.",
      ...commands("{{vm:Ubuntu}}"),
      readScreen("{{vm:Ubuntu}}"),
    ),
  },
  {
    req: "uname",
    steps: 14,
    reply:
      "Done. Both computers are containers, so uname -a prints the same host kernel on both. The os-release line tells them apart: Debian GNU/Linux 13 on the default computer and Ubuntu 24.04 on the second.",
  },
];

/** The computer demos, the team demo and the landing demos share one stand-in; their requests do not overlap. */
export const rules: Rule[] = [...landingRules, ...teamRules, ...computerRules];
