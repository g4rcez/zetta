import { defineConfig } from "drizzle-kit";

// Offline dispatch-only delta; the accepted run/identity baseline already exists.
export default defineConfig({
  schema: "./src/schema/dispatch.ts",
  out: "./dispatch-test-migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
});
