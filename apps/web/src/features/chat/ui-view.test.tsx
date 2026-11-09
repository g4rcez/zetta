import { expect, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { uiBlock } from "@zetta/render/build";
import { setupDom } from "../skills/dom-env";

const win = setupDom();

const mount = async (text: string, streaming = false) => {
  const { Response } = await import("./response");
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<Response text={text} streaming={streaming} />));
  return host;
};

const report = uiBlock({
  type: "Card",
  props: { title: "Weekly report" },
  children: [
    { type: "Table", props: { columns: ["Name", "Qty"], rows: [["apples", "3"]] } },
    {
      type: "Chart",
      props: {
        title: "Deploys per day",
        chart: {
          type: "bar",
          categories: ["Mon", "Tue"],
          series: [
            { name: "Deploys", values: [180, 210] },
            { name: "Rollbacks", values: [3, 5] },
          ],
        },
      },
    },
    {
      type: "Chart",
      props: {
        title: "Share",
        chart: {
          type: "pie",
          segments: [
            { label: "Done", value: 3 },
            { label: "Open", value: 1 },
          ],
        },
      },
    },
  ],
});

test("a zetta:ui block is drawn from the catalog between the markdown around it", async () => {
  const host = await mount(`Here is the report\n${report}\nThat is all.`);
  const text = host.textContent ?? "";
  expect(text).toContain("Here is the report");
  expect(text).toContain("Weekly report");
  expect(text).toContain("apples");
  expect(text).toContain("That is all.");
  expect(text).not.toContain('"type"');
});

test("a bar chart is one image with a legend, a hover layer and a visible values table", async () => {
  const host = await mount(report);
  const charts = [...host.querySelectorAll("figure")];
  expect(charts).toHaveLength(2);
  const bar = charts[0]!;
  const svg = bar.querySelector("svg")!;
  expect(svg.getAttribute("role")).toBe("img");
  expect(svg.getAttribute("aria-label")).toContain(
    "Deploys per day. bar chart, 2 series, 2 categories",
  );
  expect(bar.textContent).toContain("Rollbacks");
  expect(bar.querySelectorAll("svg path").length).toBe(4);
  const table = bar.querySelector("details table")!;
  expect(table.textContent).toContain("210");
  expect(table.textContent).toContain("Tue");
});

test("hovering a category shows every series value in a tooltip", async () => {
  const host = await mount(report);
  const svg = host.querySelector("figure svg")!;
  const hit = [...svg.querySelectorAll("rect")].filter(
    (r) => r.getAttribute("fill") === "transparent",
  )[1]!;
  await act(
    async () => void hit.dispatchEvent(new win.Event("pointermove", { bubbles: true }) as never),
  );
  const tip = host.querySelector('figure [aria-hidden="true"].absolute')!;
  expect(tip.textContent).toContain("Tue");
  expect(tip.textContent).toContain("210");
  expect(tip.textContent).toContain("5");
});

test("a pie lists every segment with its value and share", async () => {
  const host = await mount(report);
  const pie = host.querySelectorAll("figure")[1]!;
  expect(pie.querySelector("svg")!.getAttribute("aria-label")).toBe(
    "Share. Pie chart: Done 75%, Open 25%.",
  );
  expect(pie.textContent).toContain("Done");
  expect(pie.textContent).toContain("3 (75%)");
});

test("a block still streaming shows what has arrived, and one that never validates is shown as code", async () => {
  const half =
    '```zetta:ui\n{"op":"add","path":"/root","value":"c"}\n{"op":"add","path":"/elements/c","value":{"type":"Card","props":{"title":"Partial"},"children":[]}}';
  expect((await mount(half, true)).textContent).toContain("Partial");
  const bad = await mount(
    '```zetta:ui\n{"op":"add","path":"/root","value":"x"}\n{"op":"add","path":"/elements/x","value":{"type":"Evil","props":{}}}\n```',
  );
  expect(bad.textContent).toContain("Evil");
  expect(bad.querySelector("pre, code")).not.toBeNull();
});
