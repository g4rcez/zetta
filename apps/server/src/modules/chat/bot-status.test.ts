import { describe, expect, test } from "bun:test";
import { createLiveBots, deriveBotStatus, isResearchCall, phaseAfterRound } from "./bot-status";

const idle = { pending: 0, runningElsewhere: false };

describe("deriveBotStatus", () => {
  test("a bot with nothing going on is available", () => {
    expect(deriveBotStatus(idle)).toEqual({ status: "available", reason: "Online, no tasks" });
  });
  test("a successful last run is still available", () => {
    expect(deriveBotStatus({ ...idle, lastOutcome: "ok" }).status).toBe("available");
  });
  test("a live run shows its phase", () => {
    expect(deriveBotStatus({ ...idle, live: { phase: "planning", label: "" } })).toEqual({
      status: "planning",
      reason: "Thinking and looking things up",
    });
    expect(
      deriveBotStatus({
        ...idle,
        live: { phase: "working", label: "browser open https://a.test" },
      }),
    ).toEqual({ status: "working", reason: "browser open https://a.test" });
  });
  test("a room turn or routine in progress is working", () => {
    expect(deriveBotStatus({ ...idle, runningElsewhere: true }).status).toBe("working");
  });
  test("items waiting for the person make it pending, singular and plural", () => {
    expect(deriveBotStatus({ ...idle, pending: 1 })).toEqual({
      status: "pending",
      reason: "1 item waits for you",
    });
    expect(deriveBotStatus({ ...idle, pending: 3 }).reason).toBe("3 items wait for you");
  });
  test("a sign-in failure is an error that names the tool", () => {
    expect(
      deriveBotStatus({ ...idle, lastOutcome: "auth_required", harnessLabel: "Claude Code" }),
    ).toEqual({ status: "error", reason: "Not signed in to Claude Code" });
  });
  test("failed and timed-out runs are errors", () => {
    expect(deriveBotStatus({ ...idle, lastOutcome: "failed" }).status).toBe("error");
    expect(deriveBotStatus({ ...idle, lastOutcome: "timeout" }).status).toBe("error");
  });
  test("cancelled, busy and denied runs are not errors", () => {
    expect(deriveBotStatus({ ...idle, lastOutcome: "cancelled" }).status).toBe("available");
    expect(deriveBotStatus({ ...idle, lastOutcome: "busy" }).status).toBe("available");
    expect(deriveBotStatus({ ...idle, lastOutcome: "denied" }).status).toBe("available");
  });
  test("a harness that is not installed is offline", () => {
    expect(
      deriveBotStatus({ ...idle, lastOutcome: "not_installed", harnessLabel: "Codex" }),
    ).toEqual({ status: "offline", reason: "Codex is not installed on the server" });
  });

  describe("precedence", () => {
    test("offline beats everything", () => {
      expect(
        deriveBotStatus({
          pending: 2,
          lastOutcome: "not_installed",
          live: { phase: "working", label: "" },
          runningElsewhere: true,
        }).status,
      ).toBe("offline");
    });
    test("pending beats a running bot", () => {
      expect(
        deriveBotStatus({ ...idle, pending: 1, live: { phase: "working", label: "" } }).status,
      ).toBe("pending");
    });
    test("a running bot beats an old error: the new run may be the retry", () => {
      expect(
        deriveBotStatus({
          ...idle,
          lastOutcome: "failed",
          live: { phase: "planning", label: "" },
        }).status,
      ).toBe("planning");
    });
    test("pending beats an error", () => {
      expect(deriveBotStatus({ ...idle, pending: 1, lastOutcome: "failed" }).status).toBe(
        "pending",
      );
    });
  });
});

describe("run phase", () => {
  test("lookups are research, writes and commands are not", () => {
    expect(isResearchCall({ kind: "chats", args: {} })).toBe(true);
    expect(isResearchCall({ kind: "task", args: { action: "list" } })).toBe(true);
    expect(isResearchCall({ kind: "browser", args: { action: "read" } })).toBe(true);
    expect(isResearchCall({ kind: "browser", args: { action: "click_text", text: "Buy" } })).toBe(
      false,
    );
    expect(isResearchCall({ kind: "task", args: { action: "update" } })).toBe(false);
    expect(isResearchCall({ kind: "remember", args: { text: "x" } })).toBe(false);
  });
  test("a round of only research stays planning; one write makes it working", () => {
    expect(
      phaseAfterRound([
        { kind: "chats", args: {} },
        { kind: "browser", args: { action: "open", url: "https://a.test" } },
      ]),
    ).toBe("planning");
    expect(
      phaseAfterRound([
        { kind: "chats", args: {} },
        { kind: "task", args: { action: "add", title: "x" } },
      ]),
    ).toBe("working");
  });
});

describe("live bots", () => {
  test("a run starts as planning and only moves forward to working", () => {
    const live = createLiveBots();
    live.begin("m1", "bot1", "user1");
    expect(live.of("user1", "bot1")?.phase).toBe("planning");
    live.update("m1", { phase: "working", label: "task add" });
    live.update("m1", { phase: "planning" });
    expect(live.of("user1", "bot1")).toMatchObject({ phase: "working", label: "task add" });
  });
  test("Thinking does not replace the last real label", () => {
    const live = createLiveBots();
    live.begin("m1", "bot1", "user1");
    live.update("m1", { label: "plugin github.search" });
    live.update("m1", { label: "Thinking" });
    expect(live.of("user1", "bot1")?.label).toBe("plugin github.search");
  });
  test("a run is visible to its viewer only and disappears when it ends", () => {
    const live = createLiveBots();
    live.begin("m1", "bot1", "user1");
    expect(live.of("user2", "bot1")).toBeUndefined();
    expect(live.of("user1", "bot2")).toBeUndefined();
    live.end("m1");
    expect(live.of("user1", "bot1")).toBeUndefined();
  });
  test("with two chats open, the working run wins over the planning one", () => {
    const live = createLiveBots();
    live.begin("m1", "bot1", "user1");
    live.begin("m2", "bot1", "user1");
    live.update("m2", { phase: "working" });
    expect(live.of("user1", "bot1")?.phase).toBe("working");
  });
});
