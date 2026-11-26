// The production server: 1 vCPU, 4 GB of RAM, Arch Linux. The values that name the machine come from `.env.production` (untracked).
import { defineEnvironment } from "../src/environment";

export default defineEnvironment((values) => ({
  host: values.DEPLOY_HOST!,
  domain: values.DEPLOY_DOMAIN!,
  ssh: {
    user: values.DEPLOY_SSH_USER ?? "deploy",
    port: values.DEPLOY_SSH_PORT ?? 22,
    identityFile: values.DEPLOY_SSH_KEY,
  },
  acmeEmail: values.DEPLOY_ACME_EMAIL,
  agents: ["claude-code"],
  sandbox: "host",
  swapGiB: 4,
  postgres: {
    sharedBuffers: "512MB",
    effectiveCacheSize: "1536MB",
    workMem: "8MB",
    maintenanceWorkMem: "128MB",
    maxConnections: 40,
    appPool: 10,
  },
  // The server and, in `host` mode, the agent CLIs it starts.
  service: { memoryHigh: "2G", memoryMax: "2.6G" },
  keep: { releases: 5, backups: 7 },
}));
