// Bun test preload (see bunfig.toml). `src/env.ts` reads the app env once, from `__VARLOCK_ENV`, the first time any file imports it;
// all test files share one process, so a file that imports it before a DOM test has set the variable used to leave it uninitialised
// for every file after it. `setupDom()` sets the same value.
process.env.__VARLOCK_ENV ??= JSON.stringify({
  settings: {},
  config: { NODE_ENV: { value: "test" }, ZETTA_SERVER_URL: { value: "http://api.test" } },
});

// Work that a DOM test leaves behind can run after that test has removed `window`, and the run then ends with an unhandled error that is
// blamed on whichever file is running at that moment. Known cases: the better-auth session store cleans up a second after its last
// subscriber leaves (nanostores `onStop`, a timer) and reads `window` in its broadcast channel; and the React scheduler runs one more
// task (`setImmediate`) that reads `window.event`. Bun does not hand uncaught errors to `process.on`, so the callbacks of timers are
// wrapped instead. Only an error about `window` that happens while there is no `window` is dropped (it can only be a late callback);
// every other error from a timer still propagates.
// This must run before React is loaded: the scheduler keeps a reference to `setImmediate` when its module is evaluated.
const lateCleanup = (error: unknown) =>
  error instanceof Error &&
  (globalThis as { window?: unknown }).window == null &&
  /window is not defined|evaluating 'window\./.test(error.message);
const guarded =
  (handler: unknown) =>
  (...inner: unknown[]) => {
    try {
      return (handler as (...args: unknown[]) => unknown)(...inner);
    } catch (error) {
      if (!lateCleanup(error)) throw error;
    }
  };
const nativeSetTimeout = globalThis.setTimeout;
globalThis.setTimeout = ((handler: unknown, delay?: number, ...args: unknown[]) =>
  nativeSetTimeout(
    typeof handler === "function" ? guarded(handler) : (handler as never),
    delay,
    ...args,
  )) as unknown as typeof setTimeout;
const nativeSetImmediate = globalThis.setImmediate;
globalThis.setImmediate = ((handler: unknown, ...args: unknown[]) =>
  nativeSetImmediate(
    typeof handler === "function" ? guarded(handler) : (handler as never),
    ...args,
  )) as unknown as typeof setImmediate;

// React DOM decides, when its module is first evaluated, whether the browser has the `input` event. Every test file shares one module
// cache, so it is loaded here once with a document present; without this, typing into a field fires no onChange in a full run.
{
  const { Window } = await import("happy-dom");
  const win = new Window();
  const g = globalThis as Record<string, unknown>;
  const had = { window: "window" in g, document: "document" in g };
  const saved = { window: g.window, document: g.document };
  g.window = win;
  g.document = win.document;
  await import("react-dom");
  await import("react-dom/client");
  if (had.window) g.window = saved.window;
  else delete g.window;
  if (had.document) g.document = saved.document;
  else delete g.document;
}

// Makes this file a module so the top-level awaits above typecheck.
export {};
