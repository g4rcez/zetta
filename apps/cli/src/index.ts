#!/usr/bin/env bun
import { InfraError } from "@zetta/infra";
import { main } from "./cli";

try {
  process.exit(await main(process.argv.slice(2)));
} catch (error) {
  // A problem the person can fix is shown alone; anything else keeps its stack.
  const known = error instanceof InfraError;
  console.error(`\nerror: ${known ? error.message : ((error as Error).stack ?? error)}`);
  process.exit(1);
}
