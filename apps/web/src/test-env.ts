// Bun test preload (see bunfig.toml). `src/env.ts` reads the app env once, from `__VARLOCK_ENV`, the first time any file imports it;
// all test files share one process, so a file that imports it before a DOM test has set the variable used to leave it uninitialised
// for every file after it. `setupDom()` sets the same value.
process.env.__VARLOCK_ENV ??= JSON.stringify({
  settings: {},
  config: { NODE_ENV: { value: "test" }, VITE_SERVER_URL: { value: "http://api.test" } },
});
