import { expect, test } from "bun:test";

import { applyTextSize } from "./text-size";

test("medium leaves the document as the stylesheet draws it; the others are marked", () => {
  const root = { dataset: {} as Record<string, string | undefined> } as unknown as HTMLElement;
  applyTextSize(root, "large");
  expect(root.dataset.textSize).toBe("large");
  applyTextSize(root, "medium");
  expect("textSize" in root.dataset).toBe(false);
  applyTextSize(root, "small");
  expect(root.dataset.textSize).toBe("small");
});
