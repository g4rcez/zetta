// Controls the Postgres that ships inside Zetta without starting the server: `bun run db:embedded start|stop|status|url`.
// `start` also applies pending migrations; drizzle-kit (`db:studio`, `db:push`) reaches it while DATABASE_URL is empty.
import { embeddedLayout, zettaHome } from "../src/embedded/paths";
import { startEmbeddedDatabase } from "../src/embedded/resolve";
import { runtimeBinaries, runtimeInstalled } from "../src/embedded/runtime";
import { isRunning, runningUrl, stopEmbedded } from "../src/embedded/supervisor";

const layout = embeddedLayout(zettaHome());
const runtime = runtimeBinaries(layout.runtime);
const running = () => runtimeInstalled(layout) && isRunning(runtime, layout);

switch (process.argv[2]) {
  case "start":
    await startEmbeddedDatabase(zettaHome(), undefined, "detached");
    break;
  case "stop":
    console.log(
      runtimeInstalled(layout) && stopEmbedded(runtime, layout) === "stopped"
        ? "[db] embedded Postgres stopped"
        : "[db] embedded Postgres is not running",
    );
    break;
  case "status":
    console.log(
      running()
        ? `[db] embedded Postgres is running in ${layout.root}`
        : "[db] embedded Postgres is not running",
    );
    break;
  case "url": {
    const url = running() ? runningUrl(layout) : undefined;
    if (!url) {
      console.error("[db] embedded Postgres is not running");
      process.exit(1);
    }
    console.log(url);
    break;
  }
  default:
    console.error("Usage: bun scripts/embedded.ts start|stop|status|url");
    process.exit(2);
}
