import * as Alchemy from "alchemy";
import * as Command from "alchemy/Command";
import * as Effect from "effect/Effect";
import "varlock/auto-load";

export default Alchemy.Stack(
  "zetta",
  {
    providers: Command.providers(),
    state: Alchemy.localState(),
  },
  Effect.gen(function* () {
    const serverDev = yield* Command.Dev("server-dev", {
      command: "bun run dev:bare",
      cwd: "../../apps/server",
      // The web dev server owns :3000 and proxies /api here (apps/web/vite.config.ts).
      env: { PORT: "6000" },
    });

    return { server: serverDev.url };
  }),
);
