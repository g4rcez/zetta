import { describe, expect, test } from "bun:test";

import { uiIssueCodes } from "./ui-issues";

const block = (lines: string[]) => `Hi\n\`\`\`zetta:ui\n${lines.join("\n")}\n\`\`\`\n`;
const root = '{"op":"add","path":"/root","value":"c"}';
const card = (children: string[]) =>
  `{"op":"add","path":"/elements/c","value":{"type":"Card","props":{},"children":${JSON.stringify(children)}}}`;

describe("uiIssueCodes", () => {
  test("a clean block and a reply without blocks report nothing", () => {
    expect(uiIssueCodes("just words")).toEqual([]);
    expect(
      uiIssueCodes(
        block([
          root,
          card(["t"]),
          '{"op":"add","path":"/elements/t","value":{"type":"Text","props":{"text":"ok"}}}',
        ]),
      ),
    ).toEqual([]);
  });
  test("names the dropped part, never its content", () => {
    const text = block([
      root,
      card(["a", "b"]),
      '{"op":"add","path":"/elements/a","value":{"type":"Evil","props":{}}}',
      '{"op":"add","path":"/elements/b","value":{"type":"Text","props":{"text":5,"secret":"hunter2"}}}',
    ]);
    expect(uiIssueCodes(text)).toEqual(["unknown_type:Evil", "invalid_props:Text:text"]);
    expect(uiIssueCodes(text).join(" ")).not.toContain("hunter2");
  });
  test("a finished reply that never closed its block is judged as it stands", () => {
    expect(uiIssueCodes("```zetta:ui\n" + root + "\n" + card(["x"]))).toEqual(["dangling_child"]);
  });
});
