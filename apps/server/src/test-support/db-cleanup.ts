import type { Database } from "@zetta/db";

/** Deletes everything owned by the given synthetic test users, in foreign-key-safe order. Test databases only. */
export async function cleanupTestUsers(db: Database, ids: string[]) {
  const q = (sql: string) => db.$client.query(sql, [ids]);
  for (const t of ["audit_event", "reaction", "attachment", "delegation", "routine_run", "workflow_run", "snapshot", "config_proposal", "hook", "decision_config", "bot_connection", "browser_profile", "computer_vm", "source"]) await q(`delete from ${t} where owner_user_id = any($1)`);
  await q("delete from routine where owner_user_id = any($1)");
  await q("delete from workflow_version where workflow_id in (select id from workflow where owner_user_id = any($1))");
  await q("delete from workflow where owner_user_id = any($1)");
  for (const t of ["memory", "instruction", "attention_item", "message", "conversation"]) await q(`delete from ${t} where owner_user_id = any($1)`);
  await q("delete from bot_revision where bot_id in (select id from bot where owner_user_id = any($1))");
  await q("delete from bot where owner_user_id = any($1)");
  await q("delete from workspace where owner_user_id = any($1)");
  await q("delete from membership where user_id = any($1)");
  await q('delete from "user" where id = any($1)');
}
