import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { diagramError, PeleDiagram } from "./diagram";

describe("PeleDiagram", () => {
  test("shows the source as text while the block is still streaming", () => {
    const html = renderToStaticMarkup(
      <PeleDiagram code={"flowchart LR\n  A --> B"} isIncomplete language="mermaid" />,
    );
    expect(html).toContain("flowchart LR");
    expect(html).not.toContain("<svg");
  });

  test("shows the source until Pele has drawn it", () => {
    const html = renderToStaticMarkup(
      <PeleDiagram code="flowchart LR" isIncomplete={false} language="mermaid" />,
    );
    expect(html).toContain("<pre");
  });

  test("escapes diagram text instead of inserting it as markup", () => {
    const html = renderToStaticMarkup(
      <PeleDiagram code={"<img src=x onerror=alert(1)>"} isIncomplete language="mermaid" />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});

describe("diagramError", () => {
  test("adds the position when Pele knows it", () => {
    const error = Object.assign(new Error("Unexpected token"), {
      code: "syntax",
      line: 3,
      column: 7,
    });
    expect(diagramError(error)).toBe("Unexpected token (line 3, column 7)");
  });
  test("keeps a plain message and survives a non-error", () => {
    expect(diagramError(new Error("bad"))).toBe("bad");
    expect(diagramError("x")).toBe("The diagram could not be drawn.");
  });
});
