import { afterAll } from "bun:test";
import { Window } from "happy-dom";

const GLOBALS = [
  "window",
  "document",
  "navigator",
  "IS_REACT_ACT_ENVIRONMENT",
  "fetch",
  // The modal library checks `instanceof` against these.
  "HTMLElement",
  "Element",
  "Node",
  "ShadowRoot",
  "getComputedStyle",
  "MutationObserver",
  "requestAnimationFrame",
  "cancelAnimationFrame",
  "ResizeObserver",
] as const;

/**
 * A fake browser for a test file (happy-dom). React DOM reads these globals, and `src/env.ts` reads the app env once a window exists.
 * Bun runs every test file in one process, so the globals are put back when the file is done. Call it at the top of the file, before
 * anything from the app is imported.
 */
export function setupDom() {
  const win = new Window();
  const saved = GLOBALS.map(
    (key) => [key, Object.getOwnPropertyDescriptor(globalThis, key)] as const,
  );
  Object.assign(globalThis, {
    window: win,
    document: win.document,
    navigator: win.navigator,
    IS_REACT_ACT_ENVIRONMENT: true,
    HTMLElement: win.HTMLElement,
    Element: win.Element,
    Node: win.Node,
    ShadowRoot: win.ShadowRoot,
    getComputedStyle: win.getComputedStyle.bind(win),
    MutationObserver: win.MutationObserver,
    requestAnimationFrame: win.requestAnimationFrame.bind(win),
    cancelAnimationFrame: win.cancelAnimationFrame.bind(win),
    // happy-dom has none, and every browser does: the library's password field measures itself with it.
    ResizeObserver: class {
      observe() {}
      unobserve() {}
      disconnect() {}
    },
  });
  // happy-dom rejects a cancelled animation, which the modal library does every time it closes. A browser does not.
  win.HTMLElement.prototype.animate = (() => ({
    finished: Promise.resolve(),
    cancel() {},
    finish() {},
    addEventListener() {},
    removeEventListener() {},
  })) as never;
  process.env.__VARLOCK_ENV = JSON.stringify({
    settings: {},
    config: { NODE_ENV: { value: "test" }, ZETTA_SERVER_URL: { value: "http://api.test" } },
  });
  afterAll(() => {
    for (const [key, descriptor] of saved) {
      if (descriptor) Object.defineProperty(globalThis, key, descriptor);
      else delete (globalThis as Record<string, unknown>)[key];
    }
  });
  return win;
}
