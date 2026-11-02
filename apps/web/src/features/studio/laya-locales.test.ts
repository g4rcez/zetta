import { describe, expect, test } from "bun:test";
import { isLayaTag } from "@zetta/core/laya-languages";
import {
  ASSIST_LOCALES,
  flagOf,
  isKnownLocale,
  LAYA_LOCALES,
  localeLabel,
  localeOptions,
} from "./laya-locales";

describe("Laya locales", () => {
  test("each option shows country and language", () => {
    expect(localeLabel("pt-BR")).toBe("🇧🇷 Brazil · Portuguese");
    expect(localeLabel("ja-JP")).toBe("🇯🇵 Japan · Japanese");
    expect(localeLabel("es-MX")).toBe("🇲🇽 Mexico · Spanish");
    expect(localeLabel("de-CH")).toBe("🇨🇭 Switzerland · German");
  });
  test("a tag without a country shows the language only", () => {
    expect(localeLabel("fr")).toBe("French");
  });
  test("flags come from the region code", () => {
    expect(flagOf("BR")).toBe("🇧🇷");
    expect(flagOf("in")).toBe("🇮🇳");
  });
  test("the list holds valid, unique, non-English tags", () => {
    expect(LAYA_LOCALES.filter((t) => !isLayaTag(t))).toEqual([]);
    expect(LAYA_LOCALES.filter((t) => t.startsWith("en"))).toEqual([]);
    expect(new Set(LAYA_LOCALES).size).toBe(LAYA_LOCALES.length);
  });
  test("added locales leave the options", () => {
    const options = localeOptions(["pt-BR"]);
    expect(options.some((o) => o.value === "pt-BR")).toBe(false);
    expect(options.find((o) => o.value === "pt-PT")).toEqual({
      value: "pt-PT",
      label: "🇵🇹 Portugal · Portuguese",
    });
  });
  test("only listed locales are known", () => {
    expect(isKnownLocale("pt-BR")).toBe(true);
    expect(isKnownLocale("xx-YY")).toBe(false);
    expect(isKnownLocale("")).toBe(false);
  });
  test("Home Assistant can also be asked in English", () => {
    expect(localeOptions([], ASSIST_LOCALES)[0]).toEqual({ value: "en", label: "English" });
    expect(isKnownLocale("en", ASSIST_LOCALES)).toBe(true);
    expect(isKnownLocale("en")).toBe(false);
  });
});
