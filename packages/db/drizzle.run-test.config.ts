import { defineConfig } from "drizzle-kit";

// Offline run-only feature delta. Membership and its auth parent must already exist.
export default defineConfig({
  schema: "./src/schema/runs.ts",
  out: "./run-test-migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
});
