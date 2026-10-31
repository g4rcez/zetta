// Operator tool: gives one user (or, with --all, every user who has one) a new connection key and moves their credentials under it.
// Reads ZETTA_CONNECTION_KEY and DATABASE_URL like the server. Prints counts only, never ids, keys or secrets.
import { createDb } from "@zetta/db";

import { ENV } from "../env.server";
import { PROVIDERS } from "../modules/connections/service";
import { createConnectionStore } from "../modules/connections/store";

const [target, ...extra] = process.argv.slice(2);
if (!target || extra.length || (target !== "--all" && target.startsWith("-"))) {
  console.error("Usage: bun run connections:rotate-user-key <userId> | --all");
  process.exit(2);
}

const db = createDb(ENV);
const store = await createConnectionStore(db, {
  configuration: {
    key: ENV.ZETTA_CONNECTION_KEY,
    keyId: process.env.ZETTA_CONNECTION_KEY_ID ?? "v1",
  },
  allowedProviders: PROVIDERS,
  initializeEmpty: false,
});
const owners =
  target === "--all"
    ? (
        await db.$client.query(
          "select owner_user_id from connection_user_key order by owner_user_id",
        )
      ).rows.map((row) => String(row.owner_user_id))
    : [target];

let rotated = 0;
let credentials = 0;
let failed = 0;
for (const owner of owners) {
  try {
    credentials += (await store.rotateUserKey(owner)).credentials;
    rotated++;
  } catch (error) {
    failed++;
    console.error(`rotation refused: ${error instanceof Error ? error.message : "unknown"}`);
  }
}
console.log(
  `rotated ${rotated} user key(s), re-sealed ${credentials} credential(s), ${failed} failed`,
);
await db.$client.end();
process.exit(failed ? 1 : 0);
