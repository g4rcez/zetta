import { describe, expect, test } from "bun:test";
import { layaModelFor, normalizeLayaLanguages } from "./laya-languages";

describe("Laya languages", () => {
  test("English only asks for the English model", () => {
    expect(layaModelFor(["en"])).toBe("english");
    expect(layaModelFor(["en", "en-GB"])).toBe("english");
  });
  test("any other language asks for the multilingual model", () => {
    expect(layaModelFor(["en", "pt-BR"])).toBe("multilingual");
    expect(layaModelFor(["ja"])).toBe("multilingual");
  });
  test("English is always first, duplicates and junk are dropped", () => {
    expect(normalizeLayaLanguages([])).toEqual(["en"]);
    expect(normalizeLayaLanguages(["pt-BR", "en", "pt-BR", "es-MX"])).toEqual([
      "en",
      "pt-BR",
      "es-MX",
    ]);
    expect(normalizeLayaLanguages(["pt_BR", "EN-us", 7, "", "xx-yy", "fr"])).toEqual(["en", "fr"]);
  });
});
