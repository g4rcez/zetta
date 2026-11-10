// `ZETTA_TEST_DB=embedded bun test` runs the database-backed suites with no container: a throwaway embedded Postgres is started in a
// temp folder, migrated, and removed when the run ends. Needs the runtime archive (`bun run db:runtime`). Without the variable this file
// does nothing, and the suites skip unless their own *_DATABASE_URL variables are set.
import { startEmbeddedDatabase } from "@zetta/db/embedded/resolve";
import { afterAll } from "bun:test";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

if (process.env.ZETTA_TEST_DB === "embedded") {
  // Under /tmp where there is one: the unix socket path must stay short.
  const home = mkdtempSync(
    process.platform === "win32" ? join(tmpdir(), "zetta-test-db-") : "/tmp/zetta-test-db-",
  );
  const database = await startEmbeddedDatabase(home);
  for (const name of [
    "ZETTA_CHAT_TEST_DATABASE_URL",
    "ZETTA_INSTANCE_TEST_DATABASE_URL",
    "ZETTA_SIGNALS_TEST_URL",
  ])
    process.env[name] ||= database.url;
  // A preload `afterAll` runs once, after the last test file. `bun test` fires no process exit event.
  afterAll(() => {
    try {
      database.stop();
    } finally {
      rmSync(home, { recursive: true, force: true });
    }
  });
}
