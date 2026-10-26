import { defineConfig } from "drizzle-kit";

export default defineConfig({
  schema: "./src/schema/runs.ts",
  out: "./run-provenance-test-migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
});
