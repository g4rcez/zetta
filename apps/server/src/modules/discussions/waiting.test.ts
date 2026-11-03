import { describe, expect, test } from "bun:test";
import { createDecisionService } from "../decisions/service";
import { createWaiting } from "./waiting";

type Odds = { working: number; waiting_user: number; nothing_to_do: number; finished: number };
const WORKING: Odds = { working: 0.8, waiting_user: 0.1, nothing_to_do: 0.05, finished: 0.05 };
/** The model is the only fake: it answers from a fixed table, the rest is the real decision service. */
const decisions = (answer: (subject: string) => Odds | Promise<never>, mode: "on" | "off" = "on") =>
  createDecisionService(
    async () => ({
      close: async () => {},
      systemOne: async (subject: never) => {
        const probabilities = await answer(subject);
        const choice = Object.entries(probabilities).sort((a, b) => b[1] - a[1])[0]![0];
        return { answers: { pick: { type: "choice", choice, probabilities } } } as never;
      },
    }),
    30_000,
    { mode },
  );

describe("a bot reply that ends the conversation", () => {
  test("a reply that waits for the user says why", async () => {
    const d = decisions(() => ({
      working: 0.02,
      waiting_user: 0.9,
      nothing_to_do: 0.05,
      finished: 0.03,
    }));
    await d.warm();
    expect(await createWaiting(d).stopReason("Aguardando mensagem do usuário.", "u")).toBe(
      "waiting_user",
    );
  });
  test("the three stop options count together", async () => {
    const d = decisions(() => ({
      working: 0.05,
      waiting_user: 0.3,
      nothing_to_do: 0.35,
      finished: 0.3,
    }));
    await d.warm();
    expect(await createWaiting(d).stopReason("Nada mudou.", "u")).toBe("nothing_to_do");
  });
  test("a finished task is a stop", async () => {
    const d = decisions(() => ({
      working: 0.03,
      waiting_user: 0.02,
      nothing_to_do: 0.05,
      finished: 0.9,
    }));
    await d.warm();
    expect(await createWaiting(d).stopReason("Tudo pronto, nada mais a fazer.", "u")).toBe(
      "finished",
    );
  });
  test("a reply that keeps the work going is not a stop", async () => {
    const d = decisions(() => WORKING);
    await d.warm();
    expect(
      await createWaiting(d).stopReason("Backend, fix the failing test.", "u"),
    ).toBeUndefined();
  });
  test("an unsure reply is not a stop", async () => {
    const d = decisions(() => ({
      working: 0.2,
      waiting_user: 0.5,
      nothing_to_do: 0.2,
      finished: 0.1,
    }));
    await d.warm();
    expect(await createWaiting(d).stopReason("Maybe nothing new.", "u")).toBeUndefined();
  });
  test("a mention token is read as its label", async () => {
    let seen = "";
    const d = decisions((s) => {
      seen = s;
      return WORKING;
    });
    await d.warm();
    await createWaiting(d).stopReason(
      "[@Backend](bot:01929c3e-0000-7000-8000-000000000001) nothing to do",
      "u",
    );
    expect(seen).toBe("@Backend nothing to do");
  });
  test("Laya off, not loaded yet, failing or slow: the reply keeps working", async () => {
    const stop: Odds = { working: 0, waiting_user: 1, nothing_to_do: 0, finished: 0 };
    expect(await createWaiting(undefined).stopReason("Aguardando.", "u")).toBeUndefined();
    expect(
      await createWaiting(decisions(() => stop, "off")).stopReason("Aguardando.", "u"),
    ).toBeUndefined();
    expect(
      await createWaiting(decisions(() => stop)).stopReason("Aguardando.", "u"),
    ).toBeUndefined();
    const failing = decisions(() => Promise.reject(new Error("boom")));
    await failing.warm();
    expect(await createWaiting(failing).stopReason("Aguardando.", "u")).toBeUndefined();
    const slow = decisions(() => new Promise<never>(() => {}));
    await slow.warm();
    expect(await createWaiting(slow, 20).stopReason("Aguardando.", "u")).toBeUndefined();
  });
});
