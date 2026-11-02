import { isLayaTag } from "@zetta/core/laya-languages";

/**
 * Country + language pairs the administrator can add for Laya. The multilingual model covers about 50 languages and the
 * model card names none, so this is a list of widely used ones; common languages work best. English is always on and is not listed.
 */
export const LAYA_LOCALES: readonly string[] = [
  "af-ZA",
  "ar-EG",
  "ar-SA",
  "bg-BG",
  "bn-BD",
  "ca-ES",
  "cs-CZ",
  "da-DK",
  "de-AT",
  "de-CH",
  "de-DE",
  "el-GR",
  "es-AR",
  "es-CL",
  "es-CO",
  "es-ES",
  "es-MX",
  "et-EE",
  "fa-IR",
  "fi-FI",
  "fr-BE",
  "fr-CA",
  "fr-CH",
  "fr-FR",
  "gu-IN",
  "he-IL",
  "hi-IN",
  "hr-HR",
  "hu-HU",
  "id-ID",
  "it-IT",
  "ja-JP",
  "kn-IN",
  "ko-KR",
  "lt-LT",
  "lv-LV",
  "ml-IN",
  "mr-IN",
  "ms-MY",
  "nb-NO",
  "nl-BE",
  "nl-NL",
  "pa-IN",
  "pl-PL",
  "pt-BR",
  "pt-PT",
  "ro-RO",
  "ru-RU",
  "sk-SK",
  "sl-SI",
  "sr-RS",
  "sv-SE",
  "sw-KE",
  "ta-IN",
  "te-IN",
  "th-TH",
  "tr-TR",
  "uk-UA",
  "ur-PK",
  "vi-VN",
  "zh-CN",
  "zh-HK",
  "zh-TW",
];

const regions = new Intl.DisplayNames(["en"], { type: "region" });
const languages = new Intl.DisplayNames(["en"], { type: "language" });

/** The flag emoji of a region code, built from regional-indicator letters. */
export const flagOf = (region: string) =>
  String.fromCodePoint(...[...region.toUpperCase()].map((c) => 0x1f1e6 + c.charCodeAt(0) - 65));

/** "🇧🇷 Brazil · Portuguese" for `pt-BR`. A name the platform does not know falls back to its code. */
export function localeLabel(tag: string): string {
  const [language = tag, region] = tag.split("-");
  const name = languages.of(language) ?? language;
  return region ? `${flagOf(region)} ${regions.of(region) ?? region} · ${name}` : name;
}

/** Options for the Autocomplete: the locales that are not added yet. Search matches the code and the label. */
export const localeOptions = (added: readonly string[]) =>
  LAYA_LOCALES.filter((tag) => !added.includes(tag)).map((tag) => ({
    value: tag,
    label: localeLabel(tag),
  }));

export const isKnownLocale = (tag: string) => isLayaTag(tag) && LAYA_LOCALES.includes(tag);
