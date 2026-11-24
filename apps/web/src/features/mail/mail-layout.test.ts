import { expect, test } from "bun:test";

import { CHAT, LIST, MAILBOXES, READING, mailLayout } from "./mail-layout";

const at = (width: number, chatOpen = true, chatWidth: number = CHAT.fallback) =>
  mailLayout({ width, chatOpen, chatWidth });

// width, chat open, then what is expected
const table: [number, boolean, string][] = [
  [360, true, "menu single view"],
  [803, true, "menu single view"],
  [804, true, "menu split view"],
  [1043, true, "menu split view"],
  [1044, true, "column split view"],
  [1123, true, "column split view"],
  [1124, true, "menu split column"],
  [1363, true, "menu split column"],
  [1364, true, "column split column"],
  [1920, true, "column split column"],
  // The chat closed: the mailbox column comes back as soon as it fits without the chat.
  [1043, false, "menu split view"],
  [1044, false, "column split view"],
  [1500, false, "column split view"],
];

test("the arrangement at each width and chat state", () => {
  for (const [width, open, want] of table) {
    const l = at(width, open);
    const got = `${l.mailboxes} ${l.panes} ${l.chatColumn ? "column" : "view"}`;
    expect(`${width} ${open} ${got}`).toBe(`${width} ${open} ${want}`);
  }
});

test("chatFits says whether the chat could be a column, whatever its state", () => {
  expect(at(1123, false).chatFits).toBe(false);
  expect(at(1124, false).chatFits).toBe(true);
});

test("the conversation never gets less than the reading width while it is shown", () => {
  for (let width = LIST + READING; width <= 2200; width++) {
    for (const open of [true, false]) {
      for (const chosen of [0, CHAT.min, CHAT.fallback, CHAT.max, 5000]) {
        const l = mailLayout({ width, chatOpen: open, chatWidth: chosen });
        const used =
          LIST + (l.mailboxes === "column" ? MAILBOXES : 0) + (l.chatColumn ? l.chatWidth : 0);
        expect(width - used).toBeGreaterThanOrEqual(READING);
      }
    }
  }
});

test("a stored chat width that no longer fits is clamped, not obeyed", () => {
  expect(at(1400, true, 640).chatWidth).toBe(1400 - LIST - READING - MAILBOXES);
  expect(at(1200, true, 640).chatWidth).toBe(1200 - LIST - READING);
  expect(at(1920, true, 640).chatWidth).toBe(640);
  expect(at(1920, true, 100).chatWidth).toBe(CHAT.min);
  expect(at(1920, true, 400.4).chatWidth).toBe(400);
});

test("the widest the chat may be follows the room left over", () => {
  expect(at(1364).chatMax).toBe(CHAT.min);
  expect(at(1600).chatMax).toBe(1600 - LIST - READING - MAILBOXES);
  expect(at(2400).chatMax).toBe(CHAT.max);
});
