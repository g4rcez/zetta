import { expect, test } from "bun:test";

import { pathProblem, renameFile } from "./files";

const draft = {
  entry: "main.ts",
  files: [
    { path: "main.ts", content: "a" },
    { path: "lib/greet.ts", content: "b" },
  ],
};

test("renaming the entry file moves the entry with it", () => {
  expect(renameFile(draft, "main.ts", "report.ts")).toEqual({
    entry: "report.ts",
    files: [
      { path: "report.ts", content: "a" },
      { path: "lib/greet.ts", content: "b" },
    ],
  });
});

test("renaming another file leaves the entry alone and keeps the content", () => {
  expect(renameFile(draft, "lib/greet.ts", "lib/hello.ts")).toEqual({
    entry: "main.ts",
    files: [
      { path: "main.ts", content: "a" },
      { path: "lib/hello.ts", content: "b" },
    ],
  });
});

test("a name that is taken, or that the server would refuse, says why", () => {
  expect(renameFile(draft, "main.ts", "lib/greet.ts")).toEqual({
    problem: "lib/greet.ts is already a file.",
  });
  expect(renameFile(draft, "main.ts", "../x.ts")).toEqual({
    problem: "Use a relative path without `..`.",
  });
  expect(renameFile(draft, "main.ts", "out/a.txt")).toEqual({
    problem: "`out/` holds the files a script writes.",
  });
  expect(pathProblem("inputs.json", [])).toBe("`inputs.json` holds the inputs of a run.");
});

test("keeping the same name is not a conflict with itself", () => {
  expect(renameFile(draft, "main.ts", "main.ts")).toEqual({ entry: "main.ts", files: draft.files });
});
