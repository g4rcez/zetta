import { defineConfig } from "drizzle-kit";

// Offline feature delta; the referenced auth user table must already exist.
export default defineConfig({
  schema: "./src/schema/connections.ts",
  out: "./connection-test-migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
});
