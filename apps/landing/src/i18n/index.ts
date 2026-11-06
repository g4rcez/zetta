// The words live in src/locales/*.json (see the README there). `en.json` is the source of truth: `Copy` is its shape,
// and `ptBr: Copy` fails type-checking when pt-br.json misses a key or has a different shape.
import en from "../locales/en.json";
import ptBrJson from "../locales/pt-br.json";

export type Copy = typeof en;
export type Locale = "en" | "pt-br";

const ptBr: Copy = ptBrJson;

export const getCopy = (locale: Locale): Copy => (locale === "pt-br" ? ptBr : en);
