import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { BotsContext } from "@/components/bot-identity";

import { readBy, SeenMark } from "./seen-mark";

describe("readBy", () => {
  test("names one, two, or two and a count", () => {
    expect(readBy(["Dev"])).toBe("Read by Dev");
    expect(readBy(["Dev", "Ana"])).toBe("Read by Dev and Ana");
    expect(readBy(["Dev", "Ana", "Bo", "Cy"])).toBe("Read by Dev, Ana and 2 more");
  });
  test("survives an empty list", () => expect(readBy([])).toBe("Read by a bot"));
});

describe("SeenMark", () => {
  const bots = new Map([
    ["b1", { id: "b1", name: "Dev" }],
    ["b2", { id: "b2", name: "Ana" }],
  ]);
  test("shows nothing until a bot has read the message", () => {
    expect(renderToStaticMarkup(<SeenMark botIds={[]} />)).toBe("");
  });
  test("names the bots that read it", () => {
    const html = renderToStaticMarkup(
      <BotsContext.Provider value={bots}>
        <SeenMark botIds={["b1", "b2"]} />
      </BotsContext.Provider>,
    );
    expect(html).toContain("Read by Dev and Ana");
  });
  test("a bot the page does not know is still counted", () => {
    const html = renderToStaticMarkup(<SeenMark botIds={["gone"]} />);
    expect(html).toContain("Read by A bot");
  });
  test("shows at most four faces and the rest as a count", () => {
    const many = Array.from({ length: 6 }, (_, i) => `x${i}`);
    const html = renderToStaticMarkup(<SeenMark botIds={many} />);
    expect(html).toContain("+2");
  });
});
