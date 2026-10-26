import { defineConfig } from "drizzle-kit";

// Offline generation only. No credentials, environment loading or apply command.
export default defineConfig({
  schema: "./src/schema/index.ts",
  out: "./identity-test-migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
});
