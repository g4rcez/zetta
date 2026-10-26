import { describe, expect, test } from "bun:test";

import { uiPrompt } from "./prompt";
import { sanitizeSpec, splitReply } from "./reply";

const jsonl = [
  '{"op":"add","path":"/root","value":"c"}',
  '{"op":"add","path":"/elements/c","value":{"type":"Card","props":{"title":"T"},"children":["m","x"]}}',
  '{"op":"add","path":"/elements/m","value":{"type":"Metric","props":{"label":"Users","value":"42"},"children":[]}}',
].join("\n");
const reply = (body: string, closed = true) => `Here you go\n\`\`\`zetta:ui\n${body}\n${closed ? "```\n" : ""}`;

describe("splitReply", () => {
  test("splits markdown around a ui block and drops dangling children", () => {
    const [a, b] = splitReply(`${reply(jsonl)}Done.`);
    expect(a).toEqual({ kind: "markdown", text: "Here you go" });
    expect(b).toMatchObject({ kind: "ui", complete: true });
    const spec = (b as { spec: any }).spec;
    expect(spec.root).toBe("c");
    expect(spec.elements.c.children).toEqual(["m"]);
    expect(splitReply(`${reply(jsonl)}Done.`).at(-1)).toEqual({ kind: "markdown", text: "Done." });
  });
  test("an unclosed block while streaming is incomplete and renders what has arrived", () => {
    const seg = splitReply(reply(jsonl, false), true)[1] as { complete: boolean; spec: any };
    expect(seg.complete).toBe(false);
    expect(seg.spec.elements.c.type).toBe("Card");
  });
  test("accepts one complete JSON spec as well as JSONL", () => {
    const body = JSON.stringify({ root: "t", elements: { t: { type: "Text", props: { text: "hi" } } } });
    expect((splitReply(reply(body))[1] as { spec: any }).spec.elements.t.props.text).toBe("hi");
  });
  test("an example inside an ordinary code fence stays markdown", () => {
    const text = "```md\n```zetta:ui\n{}\n```\nafter";
    expect(splitReply(text).every((s) => s.kind === "markdown")).toBe(true);
  });
  test("a block that never produces a valid spec yields spec null", () => {
    expect((splitReply(reply("nonsense"))[1] as { spec: unknown }).spec).toBeNull();
  });
});

describe("sanitizeSpec", () => {
  const el = (type: string, props: object, children?: string[]) => ({ type, props, ...(children ? { children } : {}) });
  test("drops unknown components and invalid props but keeps the rest", () => {
    const spec = sanitizeSpec({ root: "s", elements: { s: el("Stack", {}, ["a", "b", "c"]), a: el("Evil", {}), b: el("Text", { text: 5 }), c: el("Text", { text: "ok" }) } });
    expect(spec?.elements.s?.children).toEqual(["c"]);
    expect(Object.keys(spec!.elements).sort()).toEqual(["c", "s"]);
  });
  test("rejects a bad root, cycles and repeated references", () => {
    expect(sanitizeSpec({ root: "x", elements: {} })).toBeNull();
    const spec = sanitizeSpec({ root: "s", elements: { s: el("Stack", {}, ["s", "t", "t"]), t: el("Text", { text: "a" }) } });
    expect(spec?.elements.s?.children).toEqual(["t"]);
  });
  test("strips state, actions and expressions", () => {
    const spec = sanitizeSpec({ root: "t", state: { a: 1 }, elements: { t: { ...el("Text", { text: "a", extra: 1 }), on: { press: { action: "x" } }, repeat: { statePath: "/a" } } } });
    expect(spec).toEqual({ root: "t", elements: { t: { type: "Text", props: { text: "a" }, children: [] } } });
  });
  test("only http(s) links survive", () => {
    expect(sanitizeSpec({ root: "l", elements: { l: el("Link", { label: "x", href: "javascript:alert(1)" }) } })).toBeNull();
    expect(sanitizeSpec({ root: "l", elements: { l: el("Link", { label: "x", href: "https://a.dev" }) } })).not.toBeNull();
  });
  test("leaf components ignore children", () => {
    expect(sanitizeSpec({ root: "t", elements: { t: el("Text", { text: "a" }, ["u"]), u: el("Text", { text: "b" }) } })?.elements.t?.children).toEqual([]);
  });
});

describe("uiPrompt", () => {
  test("lists every catalog component and stays compact", () => {
    const p = uiPrompt();
    for (const name of ["Stack", "Card", "Table", "Metric", "Link"]) expect(p).toContain(`- ${name} `);
    expect(p).toContain("```zetta:ui");
    expect(p.length).toBeLessThan(4500);
  });
});
