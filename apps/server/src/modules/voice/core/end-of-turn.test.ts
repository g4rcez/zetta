import { describe, expect, test } from "bun:test";
import { END_SILENCE_MS, EXTEND_MS, looksUnfinished, silenceNeeded } from "./end-of-turn";

const finished = [
  "What is the weather today?",
  "Please summarise the report.",
  "Thanks!",
  "I love you.",
  "I think so.",
  "Qual é o status do projeto?",
  "Pode resumir o relatório.",
  "Obrigado!",
  "Eu acho que sim.",
  "¿Cuál es el estado del proyecto?",
  "Resume el informe, por favor.",
  "Gracias.",
  "Vale. Gracias.",
  'He said "stop it."',
];
const unfinished = [
  "I want to",
  "Please send the report and",
  "Send it to the",
  "I need to talk about,",
  "So the thing is...",
  "So the thing is…",
  "Look at this:",
  "Please send the report.",
  "Tenho uma pergunta sobre",
  "Eu quero marcar uma reunião com o",
  "Eu quero marcar uma reunião com o.",
  "Preciso de um relatório e",
  "Quiero hablar con el",
  "Tengo una duda sobre.",
  "Necesito el informe y",
  "Hello there how are you",
];

describe("looksUnfinished", () => {
  test("empty text is not unfinished: nothing was said", () => {
    expect(looksUnfinished("")).toBe(false);
    expect(looksUnfinished("   ")).toBe(false);
  });
  for (const t of finished) test(`finished: ${t}`, () => expect(looksUnfinished(t)).toBe(false));
  // "Please send the report." is a full sentence: it is finished, so it is checked separately below.
  for (const t of unfinished.filter((t) => t !== "Please send the report."))
    test(`unfinished: ${t}`, () => expect(looksUnfinished(t)).toBe(true));
  test("a full sentence ending in a noun is finished", () =>
    expect(looksUnfinished("Please send the report.")).toBe(false));
});

describe("silenceNeeded", () => {
  test("700 ms when finished, 1200 ms when not", () => {
    expect(END_SILENCE_MS).toBe(700);
    expect(EXTEND_MS).toBe(500);
    expect(silenceNeeded("Thanks!")).toBe(700);
    expect(silenceNeeded("I want to")).toBe(1200);
    expect(silenceNeeded("")).toBe(700);
  });
});
