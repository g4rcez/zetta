import { defineConfig } from "drizzle-kit";

// Offline feature delta; the snapshot-only ancestor is never applied as SQL.
export default defineConfig({
  schema: ["./src/schema/auth.ts", "./src/schema/identity.ts"],
  out: "./identity-activation-test-migrations",
  dialect: "postgresql",
  schemaFilter: ["public"],
});
