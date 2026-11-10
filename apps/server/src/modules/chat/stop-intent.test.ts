import { describe, expect, test } from "bun:test";

import { asksToStop } from "./stop-intent";

describe("asksToStop", () => {
  test.each([
    "stop",
    "Stop.",
    "STOP!!!",
    "stop it",
    "please stop",
    "ok, stop now",
    "cancel that",
    "never mind",
    "nevermind",
    "that's enough",
    "para",
    "Para!",
    "pare",
    "pode parar",
    "pode parar, por favor",
    "para tudo",
    "cancela",
    "cancela isso",
    "chega",
    "já chega",
    "esquece",
    "esqueça isso",
    "deixa pra lá",
    "para aí",
    "@chief stop",
    "[@Ana](bot:0198c1a2-7b3c-7d4e-8f90-123456789abc) para",
  ])("%p stops the bot", (text) => {
    expect(asksToStop(text)).toBe(true);
  });

  test.each([
    "",
    "ok",
    "don't stop",
    "do not stop",
    "não para",
    "nao pare",
    "não pare agora",
    "stop the dev server and restart it",
    "para o João revisar",
    "para amanhã",
    "pare de usar o banco de teste e use o de produção",
    "cancel the 3pm meeting",
    "cancela a reunião de amanhã",
    "can you stop using emojis?",
    "enough context, now write the summary",
    "esquece o segundo item e faz só o primeiro",
  ])("%p is a normal message", (text) => {
    expect(asksToStop(text)).toBe(false);
  });

  test("a long message is never a stop, whatever it contains", () => {
    expect(asksToStop(`stop ${"x".repeat(80)}`)).toBe(false);
  });
});
