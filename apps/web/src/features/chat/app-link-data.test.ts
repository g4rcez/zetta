import { expect, test } from "bun:test";

import { parseAppLink } from "./app-link-data";

test("reads the slug and an optional name", () => {
  expect(parseAppLink('{"app":"lista-de-tarefas","name":" Lista de tarefas "}')).toEqual({
    app: "lista-de-tarefas",
    name: "Lista de tarefas",
  });
  expect(parseAppLink('{"app":"todo"}')).toEqual({ app: "todo" });
});

test("anything that is not a plain slug is refused", () => {
  for (const raw of [
    "not json",
    "null",
    "{}",
    '{"app":5}',
    '{"app":"../etc"}',
    '{"app":"A b"}',
    '{"app":""}',
    `{"app":"${"a".repeat(65)}"}`,
  ])
    expect(parseAppLink(raw)).toBeUndefined();
});
