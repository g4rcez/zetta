import { expect, test } from "bun:test";

import { parseFormCard } from "./form-card-data";

test("a card from the server is read as written", () => {
  expect(
    parseFormCard(
      '{"form":"bot_database_reset","botId":"b1","botName":"Scout","prefill":{"slug":"scout"}}',
    ),
  ).toEqual({
    form: "bot_database_reset",
    botId: "b1",
    botName: "Scout",
    prefill: { slug: "scout" },
  });
});

test("a form the app does not know, or text that is not JSON, is not drawn", () => {
  expect(
    parseFormCard('{"form":"steal_passwords","botId":null,"botName":null,"prefill":{}}'),
  ).toBeUndefined();
  expect(parseFormCard("not json")).toBeUndefined();
});

test("prefill keeps only short text under plain keys", () => {
  const card = parseFormCard(
    JSON.stringify({
      form: "bot_database_reset",
      botId: null,
      botName: null,
      prefill: { name: "Docs", "bad key": "x", url: 5, long: "y".repeat(500) },
    }),
  );
  expect(card?.prefill).toEqual({ name: "Docs", long: "y".repeat(300) });
});

test("the key form is read with its provider and name", () => {
  expect(
    parseFormCard(
      '{"form":"connection","botId":null,"botName":null,"prefill":{"provider":"openai","label":"Work"}}',
    )?.prefill,
  ).toEqual({ provider: "openai", label: "Work" });
});
