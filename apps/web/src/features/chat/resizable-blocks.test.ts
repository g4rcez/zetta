import { afterEach, expect, test } from "bun:test";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
/** The fake window's document, typed as the DOM lib's so the helpers below are checked like any other code. */
const doc = win.document as unknown as Document;
const { installResizableBlocks, GRIP_PX, MIN_HEIGHT_PX } = await import("./resizable-blocks");

const stop = installResizableBlocks(doc);
afterEach(() => doc.body.replaceChildren());

/** A rect for an element that has no layout here: the test says where the block is. */
const place = (el: Element, rect: { top: number; height: number }) => {
  (el as HTMLElement).getBoundingClientRect = () =>
    ({
      top: rect.top,
      bottom: rect.top + rect.height,
      height: rect.height,
      left: 0,
      right: 600,
      width: 600,
      x: 0,
      y: rect.top,
      toJSON: () => ({}),
    }) as DOMRect;
};

/** What Streamdown draws for a table: the block, a toolbar, and the part that scrolls under an inline `max-height`. */
function table(parent: Element = doc.body) {
  const box = doc.createElement("div");
  box.setAttribute("data-streamdown", "table-wrapper");
  box.innerHTML = `<div class="toolbar"></div><div class="scroll" style="max-height: 300px"><table data-streamdown="table"><tbody><tr><td>x</td></tr></tbody></table></div>`;
  parent.append(box);
  const scroll = box.querySelector(".scroll") as HTMLElement;
  // The block is 340px tall at the top of the page, the scrolling part 300px of it.
  place(box, { top: 0, height: 340 });
  place(scroll, { top: 36, height: 300 });
  return { box: box as unknown as HTMLElement, scroll };
}

const fire = (
  target: EventTarget,
  type: string,
  clientY: number,
  { pointerType = "mouse", ...init }: { pointerType?: string; button?: number } = {},
) => {
  const event = new win.MouseEvent(type, {
    bubbles: true,
    cancelable: true,
    clientY,
    button: 0,
    ...init,
  });
  // A MouseEvent has no pointer type of its own; a pointer event does.
  Object.defineProperty(event, "pointerType", { value: pointerType });
  target.dispatchEvent(event as never);
};
const drag = (box: HTMLElement, from: number, to: number) => {
  fire(box, "pointerdown", from);
  fire(doc, "pointermove", to);
  fire(doc, "pointerup", to);
};

test("dragging the bottom edge of a table changes the height of its scrolling part", () => {
  const { box, scroll } = table();
  // Down 150px from the grip: 300 becomes 450.
  drag(box, 340 - 4, 340 - 4 + 150);
  expect(scroll.style.maxHeight).toBe("450px");
  // And up again, further than the block can shrink: it stops at the minimum.
  drag(box, 336, 336 - 1000);
  expect(scroll.style.maxHeight).toBe(`${MIN_HEIGHT_PX}px`);
});

test("a press anywhere but on the grip changes nothing", () => {
  const { box, scroll } = table();
  drag(box, 340 - GRIP_PX - 5, 600);
  expect(scroll.style.maxHeight).toBe("300px");
  // A press on something inside the block is not on the block itself.
  fire(box.querySelector("table")!, "pointerdown", 338);
  fire(doc, "pointermove", 600);
  fire(doc, "pointerup", 600);
  expect(scroll.style.maxHeight).toBe("300px");
});

test("a touch press is left to the page: the grip is for a pointer", () => {
  const { box, scroll } = table();
  fire(box, "pointerdown", 338, { pointerType: "touch" });
  fire(doc, "pointermove", 500);
  expect(scroll.style.maxHeight).toBe("300px");
});

test("only the primary button resizes", () => {
  const { box, scroll } = table();
  fire(box, "pointerdown", 338, { button: 2 });
  fire(doc, "pointermove", 500);
  expect(scroll.style.maxHeight).toBe("300px");
});

test("the move stops following the pointer once it is released", () => {
  const { box, scroll } = table();
  drag(box, 338, 400);
  const after = scroll.style.maxHeight;
  fire(doc, "pointermove", 900);
  expect(scroll.style.maxHeight).toBe(after);
  expect(doc.body.style.userSelect).toBe("");
});

test("a double click on the grip shows the whole content, and the next one gives the height back", () => {
  const { box, scroll } = table();
  fire(box, "dblclick", 338);
  expect(scroll.style.maxHeight).toBe("none");
  fire(box, "dblclick", 338);
  expect(scroll.style.maxHeight).toBe("300px");
  // After a drag, the double click still goes back to what Streamdown set, not to the dragged height.
  drag(box, 338, 438);
  fire(box, "dblclick", 338);
  expect(scroll.style.maxHeight).toBe("none");
  fire(box, "dblclick", 338);
  expect(scroll.style.maxHeight).toBe("300px");
});

test("a code block resizes its body the same way", () => {
  const box = doc.createElement("div");
  box.setAttribute("data-streamdown", "code-block");
  box.innerHTML = `<div class="head"></div><div data-streamdown="code-block-body" style="max-height: 400px"><pre><code>x</code></pre></div>`;
  doc.body.append(box);
  const body = box.querySelector('[data-streamdown="code-block-body"]') as HTMLElement;
  place(box, { top: 0, height: 440 });
  place(body, { top: 36, height: 400 });
  drag(box as unknown as HTMLElement, 438, 338);
  expect(body.style.maxHeight).toBe("300px");
});

test("the fullscreen copy of a table has no grip", () => {
  const dialog = doc.createElement("div");
  dialog.setAttribute("data-streamdown", "table-fullscreen");
  doc.body.append(dialog);
  const { box, scroll } = table(dialog);
  drag(box, 338, 500);
  expect(scroll.style.maxHeight).toBe("300px");
});

test("installing twice on one document does not double the handler", () => {
  const { box, scroll } = table();
  const again = installResizableBlocks(doc);
  drag(box, 338, 388);
  // One handler: 300 + 50, not applied twice from a shifted start.
  expect(scroll.style.maxHeight).toBe("350px");
  again();
  stop();
});
