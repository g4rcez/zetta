import { describe, expect, test } from "bun:test";
import { SpeakableStream, cleanForSpeech, speakableSentences } from "./speakable";

const table: [string, string, string[]][] = [
  // sentences and abbreviations, three languages
  [
    "en plain",
    "Hello there. How are you? I am fine!",
    ["Hello there.", "How are you?", "I am fine!"],
  ],
  [
    "en abbreviation",
    "Dr. Smith will see you at 3 p.m. today. Bring your card.",
    ["Dr. Smith will see you at 3 p.m. today.", "Bring your card."],
  ],
  [
    "en e.g.",
    "Use a tool, e.g. a hammer. Then rest.",
    ["Use a tool, e.g. a hammer.", "Then rest."],
  ],
  [
    "en initials",
    "J. R. Smith wrote it. It sold well.",
    ["J. R. Smith wrote it.", "It sold well."],
  ],
  ["en decimal", "The price is 3.5 dollars. Pay now.", ["The price is 3.5 dollars.", "Pay now."]],
  [
    "en version",
    "Install version 2.4.1 first. Then restart.",
    ["Install version 2.4.1 first.", "Then restart."],
  ],
  ["en ellipsis", "Well... maybe. Let me see.", ["Well... maybe.", "Let me see."]],
  ["en quote", 'He said "go now." Then he left.', ['He said "go now."', "Then he left."]],
  [
    "pt plain",
    "Olá, tudo bem? Estou aqui para ajudar.",
    ["Olá, tudo bem?", "Estou aqui para ajudar."],
  ],
  [
    "pt abbreviation",
    "O Sr. Silva e a Dra. Costa chegaram. Vamos começar.",
    ["O Sr. Silva e a Dra. Costa chegaram.", "Vamos começar."],
  ],
  [
    "pt prof",
    "Fale com a Profa. Ana sobre isso. Ela sabe.",
    ["Fale com a Profa. Ana sobre isso.", "Ela sabe."],
  ],
  [
    "pt decimal",
    "Custa R$ 3,50 ou 3.5 mil. Combinado?",
    ["Custa R$ 3,50 ou 3.5 mil.", "Combinado?"],
  ],
  ["pt av", "Moro na Av. Paulista, 1000. É perto.", ["Moro na Av. Paulista, 1000.", "É perto."]],
  ["es plain", "Hola, ¿cómo estás? Todo bien.", ["Hola, ¿cómo estás?", "Todo bien."]],
  [
    "es abbreviation",
    "El Sr. López y la Dra. Pérez llegaron. Empecemos.",
    ["El Sr. López y la Dra. Pérez llegaron.", "Empecemos."],
  ],
  [
    "es ej",
    "Usa una herramienta, p.ej. un martillo. Luego descansa.",
    ["Usa una herramienta, p.ej. un martillo.", "Luego descansa."],
  ],
  ["es decimal", "Cuesta 3.5 euros. ¡Qué barato!", ["Cuesta 3.5 euros.", "¡Qué barato!"]],
  // code and structure
  [
    "code block",
    "Run this:\n```bash\nrm -rf /tmp/x. Then more.\n```\nDone. Bye.",
    ["Run this:", "Done.", "Bye."],
  ],
  ["tilde fence", "Look.\n~~~\ncode\n~~~\nAfter.", ["Look.", "After."]],
  [
    "zetta fence",
    'I will save it.\n```zetta:memory\n{"a":1}\n```\nSaved.',
    ["I will save it.", "Saved."],
  ],
  ["inline code", "Call `foo.bar()` now. It works.", ["Call now.", "It works."]],
  [
    "tool tag",
    'Checking.\n<tool_use>\n{"name":"x"}\n</tool_use>\nFound it.',
    ["Checking.", "Found it."],
  ],
  [
    "table",
    "Here it is:\n| a | b |\n|---|---|\n| 1 | 2 |\nThat is all.",
    ["Here it is:", "That is all."],
  ],
  [
    "url",
    "See https://www.example.com/docs/page?x=1 for more. Thanks.",
    ["See example.com for more.", "Thanks."],
  ],
  ["url with period", "Go to https://example.org/a.", ["Go to example.org."]],
  ["link text", "Read [the guide](https://example.com/guide) first.", ["Read the guide first."]],
  [
    "link as its own text",
    "Open [https://example.com/x](https://example.com/x) now.",
    ["Open example.com now."],
  ],
  ["image", "Look ![a cat](https://example.com/c.png) here.", ["Look a cat here."]],
  ["marks", "This is **very** _important_ and ~~old~~.", ["This is very important and old."]],
  ["snake_case kept", "Use snake_case names. Fine.", ["Use snake_case names.", "Fine."]],
  [
    "heading and list",
    "# Plan\n- first step\n- second step\n1. third step\nEnd.",
    ["Plan", "first step", "second step", "third step", "End."],
  ],
  ["quote", "> A wise note.\nOk.", ["A wise note.", "Ok."]],
  ["only code is silent", "```js\nconsole.log(1)\n```", []],
  ["unclosed fence is dropped", "Before.\n```js\nnever closed", ["Before."]],
  ["emoji dropped", "Great job \u{1F389}. Next.", ["Great job.", "Next."]],
  ["no final punctuation", "No full stop here", ["No full stop here"]],
];

describe("speakable sentences", () => {
  for (const [name, input, expected] of table)
    test(name, () => expect(speakableSentences(input)).toEqual(expected));
});

describe("streaming", () => {
  const run = (deltas: string[]) => {
    const s = new SpeakableStream();
    const out: string[] = [];
    const seenAt: number[] = [];
    deltas.forEach((d, i) => {
      for (const x of s.push(d)) {
        out.push(x);
        seenAt.push(i);
      }
    });
    return { out: [...out, ...s.flush()], seenAt };
  };

  test("a sentence is released as soon as the next one starts, not at the end", () => {
    const { out, seenAt } = run(["Hello the", "re. How ", "are you", "? Fine", " thanks."]);
    expect(out).toEqual(["Hello there.", "How are you?", "Fine thanks."]);
    expect(seenAt[0]).toBe(1);
    expect(seenAt[1]).toBe(3);
  });

  test("any way of cutting the text gives the same sentences", () => {
    const text =
      'Intro.\n```zetta:x\n{"a": 1}\n```\nSee [the doc](https://example.com/a.b) and `code.x`. Dr. Silva paid 3.5. **Done** now!\n| a | b |\n|---|---|\nLast line';
    const whole = speakableSentences(text);
    expect(whole).toEqual([
      "Intro.",
      "See the doc and.",
      "Dr. Silva paid 3.5.",
      "Done now!",
      "Last line",
    ]);
    for (const size of [1, 2, 3, 5, 7, 11]) {
      const parts: string[] = [];
      for (let i = 0; i < text.length; i += size) parts.push(text.slice(i, i + size));
      expect(run(parts).out).toEqual(whole);
    }
  });

  test("a fence split over deltas is never spoken", () => {
    const { out } = run(["Before.\n``", "`py\nprint(1)\n`", "``\nAfter."]);
    expect(out).toEqual(["Before.", "After."]);
  });

  test("reset drops what is held", () => {
    const s = new SpeakableStream();
    expect(s.push("Half a sent")).toEqual([]);
    s.reset();
    expect(s.flush()).toEqual([]);
  });
});

describe("cleanForSpeech", () => {
  test("nothing to say gives an empty string", () => {
    expect(cleanForSpeech("---")).toBe("");
    expect(cleanForSpeech("`only code`")).toBe("");
  });
  test("an address that cannot be read says link", () => {
    expect(cleanForSpeech("go to http://[bad now")).toContain("go to");
  });
});
