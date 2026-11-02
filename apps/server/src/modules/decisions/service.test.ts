import { describe, expect, test } from "bun:test";
import { createDecisionService } from "./service";

const answer = { answers: { pick: { choice: "a", probabilities: { a: 1 } } } } as never;
function fakeModel() {
  const log = { loads: 0, closes: 0 };
  const load = async () => {
    log.loads++;
    return { systemOne: async () => answer, close: async () => void log.closes++ };
  };
  return { log, load };
}

describe("decision service plugin switch", () => {
  test("off by default: nothing loads and calls are refused", async () => {
    const { log, load } = fakeModel();
    const svc = createDecisionService(load);
    expect(svc.status().state).toBe("off");
    await svc.warm();
    expect(
      await svc.choose("s", "?", ["a", "b"]).then(
        () => "ok",
        (e) => e.code,
      ),
    ).toBe("off");
    expect(log.loads).toBe(0);
  });
  test("on loads at first use, or at once with preload", async () => {
    const { log, load } = fakeModel();
    const svc = createDecisionService(load);
    svc.setMode("on");
    expect(svc.status().state).toBe("idle");
    expect(log.loads).toBe(0);
    await svc.choose("s", "?", ["a", "b"]);
    expect(svc.status().state).toBe("ready");
    const preloaded = fakeModel();
    const early = createDecisionService(preloaded.load);
    early.setMode("on", { preload: true });
    await early.warm();
    expect(preloaded.log.loads).toBe(1);
    expect(early.status().state).toBe("ready");
  });
  test("off releases the model", async () => {
    const { log, load } = fakeModel();
    const svc = createDecisionService(load);
    svc.setMode("on");
    await svc.choose("s", "?", ["a", "b"]);
    svc.setMode("off");
    await Bun.sleep(5);
    expect(log.closes).toBe(1);
    expect(svc.status().state).toBe("off");
  });
  test("turned off while loading: the model is released and the state stays off", async () => {
    const closes: string[] = [];
    const svc = createDecisionService(async () => {
      await Bun.sleep(20);
      return { systemOne: async () => answer, close: async () => void closes.push("closed") };
    });
    svc.setMode("on", { preload: true });
    svc.setMode("off");
    await Bun.sleep(60);
    expect(closes).toEqual(["closed"]);
    expect(svc.status().state).toBe("off");
  });

  test("the checkpoint follows the variant: a change replaces the loaded model", async () => {
    const events: string[] = [];
    const svc = createDecisionService(async (variant) => {
      events.push(`load ${variant}`);
      return {
        systemOne: async () => answer,
        close: async () => void events.push(`close ${variant}`),
      };
    });
    expect(svc.status().variant).toBe("english");
    svc.setMode("on", { variant: "english" });
    await svc.choose("s", "?", ["a", "b"]);
    svc.setMode("on", { variant: "multilingual" });
    expect(svc.status()).toEqual({ state: "idle", model: "laya", variant: "multilingual" });
    await Bun.sleep(5);
    await svc.choose("s", "?", ["a", "b"]);
    expect(events).toEqual(["load english", "close english", "load multilingual"]);
    expect(svc.status().state).toBe("ready");
  });
  test("the same mode and variant again loads nothing new", async () => {
    const { log, load } = fakeModel();
    const svc = createDecisionService(load);
    svc.setMode("on", { variant: "multilingual" });
    await svc.choose("s", "?", ["a", "b"]);
    svc.setMode("on", { variant: "multilingual" });
    await svc.choose("s", "?", ["a", "b"]);
    expect(log.loads).toBe(1);
  });
  test("switched to another checkpoint while loading: the old model is released, the new one is used", async () => {
    const events: string[] = [];
    const svc = createDecisionService(async (variant) => {
      if (variant === "english") await Bun.sleep(30);
      events.push(`load ${variant}`);
      return {
        systemOne: async () => answer,
        close: async () => void events.push(`close ${variant}`),
      };
    });
    svc.setMode("on", { variant: "english", preload: true });
    svc.setMode("on", { variant: "multilingual" });
    await svc.choose("s", "?", ["a", "b"]);
    await Bun.sleep(60);
    expect(events).toEqual(["load multilingual", "load english", "close english"]);
    expect(svc.status()).toEqual({ state: "ready", model: "laya", variant: "multilingual" });
  });
});
