import { pgSchema } from "drizzle-orm/pg-core";

/** Every app table, function and extension lives here; `public` stays empty. */
export const zetta = pgSchema("zetta");
