import { describe, expect, test } from "bun:test";

import { uiBlock } from "./build";
import { splitReply } from "./reply";

const parse = (block: string) => {
  const parts = splitReply(block);
  expect(parts).toHaveLength(1);
  const seg = parts[0]!;
  if (seg.kind !== "ui") throw new Error("not a ui block");
  return seg;
};

describe("uiBlock", () => {
  test("builds a block that the reader accepts without issues", () => {
    const seg = parse(
      uiBlock({
        type: "Card",
        props: { title: "Status" },
        children: [
          { type: "Badge", props: { label: "OK", tone: "success" } },
          { type: "Text", props: { text: "fine" } },
        ],
      }),
    );
    expect(seg.issues).toEqual([]);
    expect(seg.spec!.elements[seg.spec!.root]!.children).toHaveLength(2);
  });
  test("clips text and lists to the limits the catalog declares", () => {
    const seg = parse(
      uiBlock({
        type: "Card",
        props: { title: "t".repeat(500) },
        children: [
          { type: "List", props: { items: Array.from({ length: 80 }, () => "x".repeat(400)) } },
        ],
      }),
    );
    const [card, list] = [
      seg.spec!.elements[seg.spec!.root]!,
      Object.values(seg.spec!.elements).find((e) => e.type === "List")!,
    ];
    expect(String(card.props.title)).toHaveLength(120);
    expect((list.props.items as string[]).length).toBe(50);
    expect((list.props.items as string[])[0]).toHaveLength(300);
  });
  test("clips inside a chart union", () => {
    const seg = parse(
      uiBlock({
        type: "Chart",
        props: {
          title: "c",
          chart: { type: "pie", segments: [{ label: "l".repeat(200), value: 1 }] },
        },
      }),
    );
    const chart = seg.spec!.elements[seg.spec!.root]!.props.chart as {
      segments: { label: string }[];
    };
    expect(chart.segments[0]!.label).toHaveLength(60);
  });
  test("backticks cannot close the fence", () => {
    const block = uiBlock({ type: "Text", props: { text: "```evil``` `x`" } });
    expect(block.match(/```/g)!.length).toBe(2);
  });
  test("throws on a view that does not match the catalog", () => {
    expect(() => uiBlock({ type: "List", props: { items: [] } })).toThrow(
      /does not match the catalog/,
    );
  });
});
