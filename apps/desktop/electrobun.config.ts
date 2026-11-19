import type { ElectrobunConfig } from "electrobun";

export default {
  app: {
    name: "zetta",
    identifier: "app.zettabot.desktop",
    version: "0.0.1",
  },
  runtime: {
    // Closing every window hides the app in the tray (see src/bun/windows.ts); only Quit ends it.
    exitOnLastWindowClosed: false,
  },
  build: {
    // The Bun main process, not the experimental Cottontail one: the app supervises a local server and database, runs the computer
    // companion and keeps a WebSocket to the server, all of which use Bun's own process, socket and WebSocket APIs.
    mainProcess: "bun",
    bun: {
      entrypoint: "src/bun/index.ts",
    },
    // The launcher is the only bundled page. Every server window loads the server's own web UI, so there is no copy of apps/web in the app
    // (the web app talks to the server it was served from, and a bundled copy could not follow a server's version).
    views: {
      launcher: { entrypoint: "src/launcher/index.ts" },
    },
    copy: {
      "src/launcher/index.html": "views/launcher/index.html",
      "src/launcher/index.css": "views/launcher/index.css",
      "../web/public/icons/icon-192.png": "views/assets/tray.png",
      // The server the app runs on this computer (staged by scripts/prepare-resources.ts): built server and its packages, the web app, the
      // Postgres runtime and the migrations. src/bun/local-server.ts finds them next to the app's code.
      ".resources/server": "server",
      ".resources/web": "web",
      ".resources/pg": "pg",
      ".resources/db": "db",
    },
    mac: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    linux: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
    win: {
      bundleCEF: true,
      defaultRenderer: "cef",
    },
  },
} satisfies ElectrobunConfig;
