import { writeSync } from "node:fs";
import { Readable } from "node:stream";
import { readOperatorInput, runAdminOperator } from "./admin-operator";

// Inert on import. No dotenv/app services, auth factory or default DB is used.
if (import.meta.main) {
  process.exitCode = await runAdminOperator(process.argv.slice(2), process.env, {
    isTTY: () => process.stdin.isTTY === true,
    readInput: (signal) => readOperatorInput(Readable.toWeb(process.stdin), signal),
    startDeadline: (expired) => {
      const timer = setTimeout(expired, 20_000);
      return () => clearTimeout(timer);
    },
    terminate: () => { process.exit(1); },
    open: async (target) => {
      // Target AND complete input validation happen before these runtime imports.
      const { openAdminOperatorClient } = await import("@zetta/db/admin-operator-client");
      const { createAdminLifecycleService } = await import("./admin-lifecycle");
      const client = await openAdminOperatorClient(target);
      return { service: createAdminLifecycleService(client.db), close: client.close, healthy: client.healthy };
    },
    stdout: (text) => { writeSync(1, text); },
    stderr: (text) => { writeSync(2, text); },
  });
}
