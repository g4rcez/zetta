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
  it("removes wiki, task, escalate and setup blocks", () => {
    expect(stripToolFences('Done.\n```zetta:wiki\n{"action":"search"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:task\n{"action":"list"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:escalate\n{"problem":"x"}\n```')).toBe("Done.");
    expect(stripToolFences('Done.\n```zetta:setup\n{"a":')).toBe("Done.");
  });
  it("keeps a server-built setup card", () => {
    const t = 'Hi\n```zetta:setup-card\n{"a":1}';
    expect(stripToolFences(t)).toBe(t);
  });
  it("keeps zetta:ui and zetta:whatsapp blocks", () => {
    const t = "```zetta:ui\n{}\n```\n```zetta:whatsapp\n{}\n```";
    expect(stripToolFences(t)).toBe(t);
  });
});
