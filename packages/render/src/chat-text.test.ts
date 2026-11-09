import { describe, expect, test } from "bun:test";

import { uiBlock, type El } from "./build";
import { specToText, uiToText } from "./chat-text";
import { splitReply, type UiSpec } from "./reply";

const specOf = (root: El): UiSpec => {
  const seg = splitReply(uiBlock(root))[0]!;
  if (seg.kind !== "ui" || !seg.spec) throw new Error("not a ui block");
  return seg.spec;
};

const everything: El = {
  type: "Card",
  props: { title: "Weekly report", description: "Deploys and health" },
  children: [
    { type: "Heading", props: { text: "Summary" } },
    { type: "Text", props: { text: "All good this week." } },
    { type: "Badge", props: { label: "Healthy", tone: "success" } },
    {
      type: "Metric",
      props: { label: "Deploys", value: "985", hint: "vs 900 last week", trend: "up" },
    },
    {
      type: "KeyValue",
      props: {
        items: [
          { label: "Env", value: "production" },
          { label: "Version", value: "1.4.2" },
        ],
      },
    },
    { type: "Table", props: { columns: ["Name", "Qty"], rows: [["a", "1"], ["b"]] } },
    { type: "List", props: { items: ["one", "two"], ordered: true } },
    { type: "Alert", props: { title: "Heads up", message: "Disk is 90% full", tone: "warning" } },
    { type: "Progress", props: { label: "Migration", value: 60 } },
    {
      type: "Chart",
      props: {
        title: "Deploys per day",
        chart: {
          type: "bar",
          categories: ["Mon", "Tue"],
          series: [{ name: "Deploys", values: [180, 210] }],
        },
      },
    },
    { type: "Code", props: { code: "bun test" } },
    { type: "Link", props: { label: "Docs", href: "https://example.invalid/docs" } },
    { type: "Divider", props: {} },
  ],
};

describe("specToText", () => {
  const out = specToText(specOf(everything));
  test("every component prints something readable", () => {
    for (const piece of [
      "Weekly report",
      "Deploys and health",
      "Summary",
      "All good this week.",
      "Healthy",
      "Deploys: 985 ↑",
      "vs 900 last week",
      "Env: production",
      "Name | Qty",
      "1. one",
      "2. two",
      "⚠️ Heads up",
      "Disk is 90% full",
      "Migration: ▰▰▰▰▰▰▱▱▱▱ 60%",
      "Deploys per day",
      "Mon | 180",
      "bun test",
      "Docs: https://example.invalid/docs",
      "———",
    ]) {
      expect(out).toContain(piece);
    }
  });
  test("plain channels get no marks, mark channels get bold titles and fenced tables", () => {
    expect(out).not.toContain("*");
    expect(out).not.toContain("```");
    const marked = specToText(specOf(everything), { marks: true });
    expect(marked).toContain("*Weekly report*");
    expect(marked).toContain("```\nName | Qty");
    expect(marked).toContain("```\nbun test\n```");
  });
  test("a root that is not a Card is wrapped", () => {
    expect(specToText(specOf({ type: "Text", props: { text: "hi" } }))).toBe("hi");
  });
  test("a fence inside a cell or code cannot close ours", () => {
    const hostile = specToText(
      specOf({
        type: "Card",
        props: {},
        children: [
          { type: "Table", props: { columns: ["a"], rows: [["```boom"]] } },
          { type: "Code", props: { code: "x ``` y" } },
        ],
      }),
      { marks: true },
    );
    expect(hostile.match(/```/g)!.length).toBe(4);
  });
  test("a card with nothing to say is dropped, not half drawn", () => {
    expect(specToText(specOf({ type: "Card", props: {} }))).toBe("");
  });
});

describe("uiToText", () => {
  const block = uiBlock({
    type: "Card",
    props: { title: "T" },
    children: [{ type: "Text", props: { text: "inside" } }],
  });
  test("keeps the markdown around a block and replaces the block with text", () => {
    const out = uiToText(`Here you go\n${block}\nBye`);
    expect(out).toBe("Here you go\n\nT\n\ninside\n\nBye");
    expect(out).not.toContain("zetta:ui");
  });
  test("text without a block comes back untouched", () => {
    expect(uiToText("  just *words*\n\nand more ")).toBe("  just *words*\n\nand more ");
  });
  test("an invalid or unparseable block never reaches the phone as JSON", () => {
    const out = uiToText(
      'Result:\n```zetta:ui\n{"op":"add","path":"/root","value":"x"}\n{"op":"add","path":"/elements/x","value":{"type":"Evil","props":{}}}\n```\nEnd',
    );
    expect(out).toBe("Result:\n\nEnd");
    expect(uiToText("```zetta:ui\nnonsense\n```")).toBe("");
  });
  test("an example inside an ordinary code fence stays as written", () => {
    const text = "```md\n```zetta:ui\n{}\n```\nafter";
    expect(uiToText(text)).toContain("```zetta:ui");
  });
  test("an app link block becomes one line with the name and the path", () => {
    const text =
      'Done.\n\n```zetta:app.linkto\n{"app":"lista-de-tarefas","name":"Lista de tarefas"}\n```';
    expect(uiToText(text)).toBe("Done.\n\n📱 Lista de tarefas: /apps/lista-de-tarefas");
    expect(uiToText('```zetta:app.linkto\n{"app":"../x"}\n```')).toBe("");
    expect(uiToText("```zetta:app.linkto\nnot json\n```")).toBe("");
  });
});
