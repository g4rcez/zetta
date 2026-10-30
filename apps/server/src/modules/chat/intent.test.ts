import { describe, expect, test } from "bun:test";
import { asksToKeep } from "./intent";

describe("asking to keep something", () => {
  test("recognises the request in English, Portuguese and Spanish", () => {
    expect(asksToKeep("Remember that I prefer metric units")).toBe(true);
    expect(asksToKeep("Lembre que eu prefiro respostas curtas")).toBe(true);
    expect(asksToKeep("a partir de agora responda em português")).toBe(true);
    expect(asksToKeep("Recuerda que trabajo de noche")).toBe(true);
  });
  test("an ordinary request is not one", () => {
    expect(asksToKeep("Summarise this repository's README")).toBe(false);
    expect(asksToKeep("Qual o preço do dólar hoje?")).toBe(false);
  });
});
