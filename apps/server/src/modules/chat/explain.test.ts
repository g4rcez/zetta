import { describe, expect, test } from "bun:test";
import { splitReply } from "@zetta/render/reply";
import { PluginError } from "../integrations/plugins/registry";
import { explain, problemBlock, problemForBot } from "./explain";

class McpError extends Error { constructor(readonly code: string) { super(code); } }
class ComputerError extends Error { constructor(readonly code: string) { super(code); } }

describe("explained tool failures", () => {
  test("a plugin's own explanation wins; the shared table only fills the gaps", () => {
    const own = explain("Telegram: send message", new PluginError("CHAT_NOT_FOUND", "Telegram could not find that chat.", "Ask them to press Start."));
    expect(own).toMatchObject({ code: "CHAT_NOT_FOUND", title: "Telegram: send message didn't work", why: "Telegram could not find that chat.", fix: "Ask them to press Start." });
    const gap = explain("Google: gmail search", new PluginError("NEEDS_AUTH", "Google is not connected."));
    expect(gap.why).toBe("Google is not connected."); expect(gap.fix).toContain("press Connect");
    const bare = explain("X: y", new PluginError("NOT_BOUND"));
    expect(bare.why).toBe("This bot is not allowed to use it."); expect(bare.fix).toContain("Plugins & MCP");
  });
  test("every kind of failure gets a what, a why and a what-to-do, never just a code", () => {
    for (const e of [new McpError("FAILED"), new McpError("TIMEOUT"), new ComputerError("LIMIT"), new ComputerError("UNAVAILABLE"), new ComputerError("HUMAN_IN_CONTROL"), new PluginError("FAILED"), new Error("timeout")]) {
      const p = explain("Thing: act", e);
      expect(p.why.length).toBeGreaterThan(10); expect(p.fix.length).toBeGreaterThan(10); expect(p.title).toBe("Thing: act didn't work");
    }
    expect(explain("m: t", new McpError("FAILED")).why).toContain("MCP server");
    expect(explain("c: x", new Error("timeout")).code).toBe("TIMEOUT");
  });
  test("unknown errors are reported as unexpected without leaking their message", () => {
    const secret = "https://api.example.com/bot123:SECRET/send";
    const p = explain("Thing: act", new Error(`fetch failed ${secret}`));
    expect(p).toMatchObject({ code: "ERROR", why: expect.stringContaining("unexpected"), fix: expect.stringContaining("server logs") });
    expect(JSON.stringify(p)).not.toContain("SECRET");
    expect(explain("Thing: act", "boom").code).toBe("ERROR");
  });
  test("the bot is told to explain it and not repeat the call", () => {
    const t = problemForBot(explain("Telegram: send message", new PluginError("SEND_DISABLED", "Sending is off.", "Turn it on.")));
    expect(t).toContain("failed (SEND_DISABLED): Sending is off."); expect(t).toContain("Turn it on."); expect(t).toContain("do not repeat the identical call");
  });
  test("the user callout is a valid zetta:ui alert even for very long texts and hostile names", () => {
    const long = "x".repeat(2000);
    const block = problemBlock(explain("A".repeat(300) + " `tick`", new PluginError("CUSTOM", long, long)), "Bot`name".repeat(20));
    const parts = splitReply(block);
    expect(parts).toHaveLength(1);
    const seg = parts[0]!; if (seg.kind !== "ui") throw new Error("not a ui block");
    expect(seg.spec).not.toBeNull();
    const el = seg.spec!.elements[seg.spec!.root]!;
    expect(el.type).toBe("Alert"); expect(el.props.tone).toBe("danger"); expect(String(el.props.message)).toContain("What you can do:");
  });
  test("the callout reads as what happened, what you can do and what to ask the bot", () => {
    const block = problemBlock(explain("Telegram: send message", new PluginError("NOT_STARTED", "Telegram does not allow the bot to message that person.", "Ask them to press Start.")), "Chief");
    const seg = splitReply(block)[0]!; if (seg.kind !== "ui") throw new Error("not ui");
    const el = seg.spec!.elements[seg.spec!.root]!;
    expect(el.props.title).toBe("Telegram: send message didn't work");
    expect(el.props.message).toBe("Telegram does not allow the bot to message that person.\n\nWhat you can do: Ask them to press Start.\nThen ask Chief to try again.");
  });
});
