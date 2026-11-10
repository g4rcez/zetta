// Bun test preload (see bunfig.toml). `src/env.ts` reads the app env once, from `__VARLOCK_ENV`, the first time any file imports it;
// all test files share one process, so a file that imports it before a DOM test has set the variable used to leave it uninitialised
// for every file after it. `setupDom()` sets the same value.
process.env.__VARLOCK_ENV ??= JSON.stringify({
  settings: {},
  config: { NODE_ENV: { value: "test" }, VITE_SERVER_URL: { value: "http://api.test" } },
});

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
