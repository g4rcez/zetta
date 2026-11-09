import { describe, expect, test as it } from "bun:test";

import { stripToolFences } from "./tool-fences";

describe("stripToolFences", () => {
  it("removes a finished tool block and keeps the prose", () => {
    const t = 'I\'ll check.\n\n```zetta:plugin\n{"plugin":"postgres"}\n```';
    expect(stripToolFences(t)).toBe("I'll check.");
  });
  it("removes a block that is still being written", () => {
    expect(stripToolFences('Checking.\n```zetta:plugin\n{"plug')).toBe("Checking.");
  });
  it("removes a permission request block", () => {
    const t = 'Asked.\n```zetta:permission\n{"rule":"WebFetch"}\n```';
    expect(stripToolFences(t)).toBe("Asked.");
  });
  it("removes a plan block, finished or still being written", () => {
    expect(stripToolFences('Starting.\n```zetta:plan\n{"steps":[{"id":"1"}]}\n```')).toBe(
      "Starting.",
    );
    expect(stripToolFences('Starting.\n```zetta:plan\n{"st')).toBe("Starting.");
  });
  it("removes an assign block, finished or still being written", () => {
    expect(
      stripToolFences(
        'Merging now.\n```zetta:assign\n{"bot":"Dev","task":"t","done_when":"d"}\n```',
      ),
    ).toBe("Merging now.");
    expect(stripToolFences('Merging now.\n```zetta:assign\n{"bot":"De')).toBe("Merging now.");
  });
  it("removes memory, task, escalate and setup blocks", () => {
    expect(stripToolFences('Done.\n```zetta:memory\n{"action":"search"}\n```')).toBe("Done.");
    // `zetta:wiki` is the old name of the same block.
    expect(stripToolFences('Done.\n```zetta:wiki\n{"action":"search"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:task\n{"action":"list"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:escalate\n{"problem":"x"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:setup\n{"a":')).toBe("Done.");
  });
  it("removes a folder block, and a workspace block written before the rename", () => {
    expect(stripToolFences('Done.\n```zetta:folder\n{"action":"list"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:workspace\n{"action":"list"}\n```')).toBe("Done.");
  });
  it("keeps a server-built setup card", () => {
    const t = 'Hi\n```zetta:setup-card\n{"a":1}';
    expect(stripToolFences(t)).toBe(t);
  });
  it("removes an inbound request but keeps the server-built inbound card", () => {
    expect(stripToolFences('Done.\n```zetta:inbound\n{"action":"status"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:inbound\n{"act')).toBe("Done.");
    const t = 'Hi\n```zetta:inbound-card\n{"a":1}';
    expect(stripToolFences(t)).toBe(t);
  });
  it("keeps zetta:ui and zetta:whatsapp blocks", () => {
    const t = "```zetta:ui\n{}\n```\n```zetta:whatsapp\n{}\n```";
    expect(stripToolFences(t)).toBe(t);
  });
  it("removes a zetta:app block, finished or still being written, but not a longer name", () => {
    expect(stripToolFences('Done.\n```zetta:app\n{"action":"list"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:app\n{"action":"create","ti')).toBe("Done.");
    const t2 = "Hi\n```zetta:apps\n{}";
    expect(stripToolFences(t2)).toBe(t2);
  });
  it("keeps a finished app link block for its card and hides one still being written", () => {
    const done = 'Made it.\n```zetta:app.linkto\n{"app":"todo"}\n```\nOpen it.';
    expect(stripToolFences(done)).toBe(done);
    expect(stripToolFences('Made it.\n```zetta:app.linkto\n{"app":"to')).toBe("Made it.");
  });
});
