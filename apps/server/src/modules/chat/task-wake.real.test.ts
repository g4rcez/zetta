import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Laya } from "@zetta/laya";
import { createDecisionService } from "../decisions/service";
import { createTaskWake } from "./task-wake";

// Opt-in (loads the multilingual Laya weights, about 1.3 GB): ZETTA_LAYA_TEST=1.
const suite = process.env.ZETTA_LAYA_TEST === "1" ? describe : describe.skip;

const CRM = {
  title: "Connect the CRM account",
  description: "Sign in so I can read the leads",
  botSaid: "I need you to sign in to the CRM. I will wait.",
};
const PT = {
  title: "Aprovar o orçamento de março",
  description: "Preciso da sua aprovação para fechar a compra.",
  botSaid: "Aguardo a sua aprovação do orçamento.",
};
const ES = {
  title: "Enviar el export del CRM",
  description: "Necesito el archivo CSV para seguir con el informe.",
  botSaid: "Cuando tengas el CSV, avísame.",
};
const KEY = {
  title: "Share the API key",
  description: "I need the staging key to run the tests.",
  botSaid: "Please share the staging API key.",
};
const DONE = "moved the task to Done";
const DELETED = "deleted the task";

suite(
  "a person's change to a task a bot asked for, against the real multilingual Laya model",
  () => {
    const decisions = createDecisionService((variant) => Laya.load({ variant }), 120_000, {
      mode: "on",
      variant: "multilingual",
    });
    const wake = createTaskWake(decisions, 60_000);
    beforeAll(async () => {
      await decisions.warm();
    });
    afterAll(() => decisions.close());

    test.each([
      ["en done", { ...CRM, change: DONE }],
      ["pt done", { ...PT, change: DONE }],
      ["es done", { ...ES, change: DONE }],
      ["en deleted", { ...CRM, change: DELETED }],
      ["pt deleted", { ...PT, change: DELETED }],
    ])("%s runs the bot", async (_name, input) => {
      expect(await wake.shouldWake(input, "u")).toBe(true);
    });
    test("a task put back in the backlog only gets a note", async () => {
      expect(await wake.shouldWake({ ...KEY, change: "moved the task to Backlog" }, "u")).toBe(
        false,
      );
    });
  },
);
