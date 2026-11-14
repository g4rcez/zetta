import { describe, expect, test } from "bun:test";
import {
  createLiveBots,
  currentTasks,
  deriveBotStatus,
  isResearchCall,
  phaseAfterRound,
  taskLine,
} from "./bot-status";

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
  test("a working bot says which task it is on, with its steps", () => {
    const task = {
      id: "t1",
      title: "Write the report",
      status: "in_progress",
      stepsDone: 2,
      stepsTotal: 5,
    };
    expect(deriveBotStatus({ ...idle, task, live: { phase: "working", label: "bash" } })).toEqual({
      status: "working",
      reason: "Working on “Write the report” · 2 of 5 steps done",
    });
    expect(
      deriveBotStatus({
        ...idle,
        task: { ...task, stepsTotal: 0 },
        live: { phase: "planning", label: "" },
      }).reason,
    ).toBe("Working on “Write the report”");
    expect(deriveBotStatus({ ...idle, task, runningElsewhere: true }).reason).toBe(
      "Working on “Write the report” · 2 of 5 steps done",
    );
  });
  test("an idle bot with open tasks says so, and a followed one says it will continue", () => {
    const task = { id: "t1", title: "Deploy", status: "backlog", stepsDone: 0, stepsTotal: 0 };
    expect(deriveBotStatus({ ...idle, task, openTasks: 1 }).reason).toBe("Online, 1 open task");
    expect(deriveBotStatus({ ...idle, task, openTasks: 3 }).reason).toBe("Online, 3 open tasks");
    expect(deriveBotStatus({ ...idle, task: { ...task, followed: true }, openTasks: 1 })).toEqual({
      status: "available",
      reason: "Continues “Deploy” soon",
    });
  });
  test("a long title is cut in the line", () => {
    const line = taskLine({
      id: "t",
      title: "x".repeat(200),
      status: "backlog",
      stepsDone: 0,
      stepsTotal: 0,
    });
    expect(line.length).toBeLessThan(90);
    expect(line).toContain("…");
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

describe("currentTasks", () => {
  const row = (id: string, status: string, followUp = "off", minutes = 0) => ({
    id,
    botId: "bot1",
    title: id,
    status,
    followUp,
    updatedAt: new Date(Date.UTC(2026, 10, 13, 12, minutes)),
  });
  const pick = (rows: ReturnType<typeof row>[]) => currentTasks(rows).get("bot1")?.id;
  test("started work beats a followed backlog task, which beats a plain one, which beats a task held for a person", () => {
    expect(pick([row("held", "review", "off", 9), row("plain", "backlog", "off", 8)])).toBe(
      "plain",
    );
    expect(pick([row("plain", "backlog", "off", 8), row("followed", "backlog", "auto", 1)])).toBe(
      "followed",
    );
    expect(
      pick([row("followed", "backlog", "auto", 9), row("started", "in_progress", "off", 1)]),
    ).toBe("started");
  });
  test("among equals the most recently touched wins, and a task without a bot is skipped", () => {
    expect(pick([row("old", "in_progress", "off", 1), row("new", "in_progress", "off", 5)])).toBe(
      "new",
    );
    expect(currentTasks([{ ...row("lost", "in_progress"), botId: null }]).size).toBe(0);
  });
});
