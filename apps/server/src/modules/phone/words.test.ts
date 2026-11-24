import { describe, expect, test } from "bun:test";
import { WORDS, asksNotToBeCalled, phoneLanguageOf } from "./words";

describe("do not call me again", () => {
  test.each([
    "Don't call me again",
    "please do not call me",
    "stop calling me",
    "Never call this number again.",
    "take me off your call list",
    "Não me ligue mais",
    "nao me liga mais por favor",
    "pare de me ligar",
    "Não quero mais ligações",
    "No me llames más",
    "no me llame",
    "Deja de llamarme",
    "no me vuelvas a llamar",
    "No quiero que me llamen",
  ])("%s is a request", (said) => {
    expect(asksNotToBeCalled(said)).toBe(true);
  });
  test.each([
    "Please call me back tomorrow",
    "I would like to leave a message",
    "me ligue amanhã",
    "llámame mañana",
    "can you call my sister",
    "",
    "no hay problema",
  ])("%s is not", (said) => {
    expect(asksNotToBeCalled(said)).toBe(false);
  });
});

describe("the fixed sentences", () => {
  test("the opening says whose automated assistant answers, in each language", () => {
    expect(WORDS.en.greeting("Ana")).toBe("Hello, this is Ana's automated assistant.");
    expect(WORDS.pt.greeting("Ana")).toContain("assistente automático de Ana");
    expect(WORDS.es.greeting("Ana")).toContain("asistente automático de Ana");
  });
  test("the language comes from the tag, English otherwise", () => {
    expect(phoneLanguageOf("pt-BR")).toBe("pt");
    expect(phoneLanguageOf("es")).toBe("es");
    expect(phoneLanguageOf("fr-FR")).toBe("en");
    expect(phoneLanguageOf(undefined)).toBe("en");
  });
});
