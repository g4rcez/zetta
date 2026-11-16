// A throwaway embedded Postgres (migrated) for the scripts that need the server's real code but not a whole stack.
import { createDb } from "../../packages/db/src/index";
import { startEmbeddedDatabase } from "../../packages/db/src/embedded/resolve";
import { mkdtempSync, rmSync } from "node:fs";

export async function throwawayDb() {
  // Under /tmp: the unix socket path must stay short.
  const home = mkdtempSync("/tmp/zetta-e2e-db-");
  const database = await startEmbeddedDatabase(home);
  const db = createDb({ DATABASE_URL: database.url } as never);
  return {
    db,
    url: database.url,
    async stop() {
      try {
        database.stop();
      } finally {
        rmSync(home, { recursive: true, force: true });
      }
    },
  };
}
