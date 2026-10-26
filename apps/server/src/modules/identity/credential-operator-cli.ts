import { writeSync } from "node:fs";
import { Readable } from "node:stream";
import { readOperatorInput } from "./admin-operator";
import { runCredentialOperator } from "./credential-operator";

if (import.meta.main) {
  process.exitCode = await runCredentialOperator(process.argv.slice(2), process.env, {
    isTTY: () => process.stdin.isTTY === true,
    readInput: (signal) => readOperatorInput(Readable.toWeb(process.stdin), signal),
    startDeadline: (expired) => {
      const timer = setTimeout(expired, 20_000);
      return () => clearTimeout(timer);
    },
    terminate: () => { process.exit(1); },
    open: async (target) => {
      const { openAdminOperatorClient } = await import("@zetta/db/admin-operator-client");
      const { createOperatorCredentialProvisioner } = await import("@zetta/auth/operator-provisioning");
      const { createAdminLifecycleService } = await import("./admin-lifecycle");
      const { randomBytes } = await import("node:crypto");
      // Private, never-mounted config; the library password hash is independent of this secret.
      const config = { BETTER_AUTH_URL: "https://operator.identity.invalid", BETTER_AUTH_SECRET: randomBytes(48).toString("base64url") };
      const client = await openAdminOperatorClient(target);
      return {
        provision: createOperatorCredentialProvisioner(config, client.db),
        service: createAdminLifecycleService(client.db), close: client.close, healthy: client.healthy,
      };
    },
    stdout: (text) => { writeSync(1, text); },
    stderr: (text) => { writeSync(2, text); },
  });
}
