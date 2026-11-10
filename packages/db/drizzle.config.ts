import { defineConfig } from "drizzle-kit";
import "varlock/auto-load";

import { embeddedLayout, zettaHome } from "./src/embedded/paths";
import { runningUrl } from "./src/embedded/supervisor";

export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./src/migrations",
  dialect: "postgresql",
  schemaFilter: ["zetta"],
  dbCredentials: {
    // An empty DATABASE_URL means the embedded Postgres: it must be running (start the server, or `bun run db:embedded start`).
    url: process.env.DATABASE_URL || runningUrl(embeddedLayout(zettaHome())) || "",
  },
});
