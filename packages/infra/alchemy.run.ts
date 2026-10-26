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
    });

    return { server: serverDev.url };
  }),
);
