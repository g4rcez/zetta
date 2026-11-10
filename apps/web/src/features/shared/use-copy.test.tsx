import { afterAll, expect, mock, test } from "bun:test";
import { act } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";
import { useCopy } from "./use-copy";

const win = setupDom();
(globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;

function Probe({ text, onFail }: { text: string; onFail: () => void }) {
  const { copied, copy } = useCopy(onFail);
  return (
    <button type="button" onClick={() => void copy(text)}>
      {copied ? "copied" : "copy"}
    </button>
  );
}

const setClipboard = (clipboard: unknown) =>
  Object.defineProperty(win.navigator, "clipboard", { value: clipboard, configurable: true });

async function press(onFail: () => void) {
  win.document.body.replaceChildren();
  const host = win.document.createElement("div");
  win.document.body.append(host);
  const root = createRoot(host as unknown as Element);
  await act(async () => root.render(<Probe text="[[note]]" onFail={onFail} />));
  const button = host.querySelector("button")!;
  await act(async () => {
    button.dispatchEvent(new win.MouseEvent("click", { bubbles: true }));
  });
  const label = button.textContent;
  await act(async () => root.unmount());
  return label;
}

afterAll(() => win.close?.());

test("a copy that works shows copied and writes the text", async () => {
  const written: string[] = [];
  setClipboard({ writeText: async (t: string) => void written.push(t) });
  const onFail = mock(() => {});
  expect(await press(onFail)).toBe("copied");
  expect(written).toEqual(["[[note]]"]);
  expect(onFail).not.toHaveBeenCalled();
});

test("a clipboard that refuses calls onFail and never shows copied", async () => {
  setClipboard({ writeText: () => Promise.reject(new Error("denied")) });
  const onFail = mock(() => {});
  expect(await press(onFail)).toBe("copy");
  expect(onFail).toHaveBeenCalledTimes(1);
});

test("a missing clipboard is a failure, not an exception", async () => {
  setClipboard(undefined);
  const onFail = mock(() => {});
  expect(await press(onFail)).toBe("copy");
  expect(onFail).toHaveBeenCalledTimes(1);
});
