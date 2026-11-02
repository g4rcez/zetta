import { en, type Copy } from "./en";
import { ptBr } from "./pt-br";

export type Locale = "en" | "pt-br";

export const getCopy = (locale: Locale): Copy => (locale === "pt-br" ? ptBr : en);
