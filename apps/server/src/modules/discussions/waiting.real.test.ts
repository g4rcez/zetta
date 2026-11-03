import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Laya } from "@zetta/laya";
import { createDecisionService } from "../decisions/service";
import { createWaiting } from "./waiting";

// Opt-in (loads the multilingual Laya weights, about 1.3 GB): ZETTA_LAYA_TEST=1.
const suite = process.env.ZETTA_LAYA_TEST === "1" ? describe : describe.skip;

suite("replies that end the conversation, against the real multilingual Laya model", () => {
  const decisions = createDecisionService((variant) => Laya.load({ variant }), 120_000, {
    mode: "on",
    variant: "multilingual",
  });
  const waiting = createWaiting(decisions, 60_000);
  beforeAll(async () => {
    await decisions.warm();
  });
  afterAll(() => decisions.close());

  test.each([
    "Aguardando mensagem do usuário.",
    "I will be in silence until the user writes.",
    "Sin novedades. Espero tu mensaje.",
  ])("%s waits for the user", async (text) => {
    expect(await waiting.stopReason(text, "u")).toBe("waiting_user");
  });
  test.each([
    "Nada a fazer no #70 agora. Só faço o merge (squash) depois do OK do Allan nas imagens, se os checks ainda estiverem verdes.",
    "Não vou mais responder às mensagens dos bots que dizem só que não têm nada a fazer. Até você escrever ou o head mudar, esta sala fica em silêncio.",
    "Backend, you have nothing to do on #70. Do not reply to this message.",
    "Nada mudou no #70. O head ainda é b125e89, e o tester, o designer e o revisor já aprovaram. O merge espera só o seu OK nas 16 imagens.",
    "Tudo pronto: o PR #12 foi mesclado e o deploy terminou. Não há mais nada a fazer.",
    "The task is complete. The report is attached and nothing is left.",
  ])("%s ends the conversation", async (text) => {
    expect(await waiting.stopReason(text, "u")).toBeDefined();
  });
  test.each([
    "Backend, corrija o teste que falhou em src/login.test.ts e abra um PR.",
    "Revisor, pode revisar o PR #70? Já atualizei as 16 imagens.",
    "Voy a revisar el código ahora y te aviso con los resultados.",
    "Frontend, a tela de login quebra no Android 14. Corrija e avise.",
  ])("%s keeps working", async (text) => {
    expect(await waiting.stopReason(text, "u")).toBeUndefined();
  });
});
