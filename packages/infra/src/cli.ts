// bun run infra <command> [--env production] [--dry-run]     (docs/operations/vps.md)
import { runInfra } from "./index";

await runInfra(process.argv.slice(2), { program: "bun run infra" });
