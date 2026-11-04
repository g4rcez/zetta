import { describe, expect, test } from "bun:test";
import { createDecisionService } from "../decisions/service";
import { createTaskWake, type WakeInput } from "./task-wake";

type Odds = { finished: number; moved_along: number };
/** The model is the only fake: it answers from a function of the subject, the rest is the real decision service. */
const decisions = (
  answer: (subject: string) => Odds | Promise<never>,
  mode: "on" | "off" = "on",
) => {
  const subjects: string[] = [];
  const service = createDecisionService(
    async () => ({
      close: async () => {},
      systemOne: async (subject: never) => {
        subjects.push(String(subject));
        const probabilities = await answer(String(subject));
        const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
        return { answers: { pick: { type: "choice", choice, probabilities } } } as never;
      },
    }),
    30_000,
    { mode },
  );
  return { service, subjects };
};

const input: WakeInput = {
  title: "Connect the CRM account",
  description: "Sign in so I can read the leads",
  botSaid: "I need you to sign in to the CRM.",
  change: "moved the task to In progress",
};

describe("should the bot that asked run after a person changed its task", () => {
  test("a confident note is enough: the model is not called", async () => {
    const { service } = decisions(() => ({ finished: 0.03, moved_along: 0.97 }));
    await service.warm();
    expect(await createTaskWake(service).shouldWake(input, "u")).toBe(false);
  });

  test("a confident wake runs the bot", async () => {
    const { service } = decisions(() => ({ finished: 0.95, moved_along: 0.05 }));
    await service.warm();
    expect(await createTaskWake(service).shouldWake(input, "u")).toBe(true);
  });

  test("an unsure answer runs the bot", async () => {
    const { service } = decisions(() => ({ finished: 0.4, moved_along: 0.6 }));
    await service.warm();
    expect(await createTaskWake(service).shouldWake(input, "u")).toBe(true);
  });

  test("the model sees the task, what the bot said and the change", async () => {
    const { service, subjects } = decisions(() => ({ finished: 0.5, moved_along: 0.5 }));
    await service.warm();
    await createTaskWake(service).shouldWake(input, "u");
    expect(subjects[0]).toContain("Connect the CRM account");
    expect(subjects[0]).toContain("Sign in so I can read the leads");
    expect(subjects[0]).toContain("I need you to sign in to the CRM.");
    expect(subjects[0]).toContain("moved the task to In progress");
  });

  test("a long text is cut before it reaches the model", async () => {
    const { service, subjects } = decisions(() => ({ finished: 0.5, moved_along: 0.5 }));
    await service.warm();
    await createTaskWake(service).shouldWake(
      { ...input, description: "d".repeat(5000), botSaid: "b".repeat(5000) },
      "u",
    );
    expect(subjects[0]!.length).toBeLessThan(900);
  });

  test("Laya off, still loading or without a model runs the bot, and nothing is loaded for it", async () => {
    const off = decisions(() => ({ finished: 0.01, moved_along: 0.99 }), "off");
    expect(await createTaskWake(off.service).shouldWake(input, "u")).toBe(true);
    const idle = decisions(() => ({ finished: 0.01, moved_along: 0.99 }));
    expect(await createTaskWake(idle.service).shouldWake(input, "u")).toBe(true);
    expect(idle.subjects).toEqual([]);
    expect(await createTaskWake(undefined).shouldWake(input, "u")).toBe(true);
  });

  test("an error or a slow model runs the bot", async () => {
    const broken = decisions(() => Promise.reject(new Error("boom")));
    await broken.service.warm();
    expect(await createTaskWake(broken.service).shouldWake(input, "u")).toBe(true);
    const slow = decisions(() => new Promise<never>(() => {}));
    await slow.service.warm();
    expect(await createTaskWake(slow.service, 20).shouldWake(input, "u")).toBe(true);
  });
});
