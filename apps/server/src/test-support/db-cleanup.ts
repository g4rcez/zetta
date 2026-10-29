import type { Database } from "@zetta/db";

/** Deletes everything owned by the given synthetic test users, in foreign-key-safe order. Test databases only. */
export async function cleanupTestUsers(db: Database, ids: string[]) {
  const q = (sql: string) => db.$client.query(sql, [ids]);
  for (const t of [
    "audit_event",
    "reaction",
    "attachment",
    "delegation",
    "routine_run",
    "workflow_run",
    "snapshot",
    "config_proposal",
    "hook",
    "decision_config",
    "bot_connection",
    "browser_profile",
    "computer_vm",
    "source",
  ])
    await q(`delete from ${t} where owner_user_id = any($1)`);
  await q("delete from routine where owner_user_id = any($1)");
  await q(
    "delete from workflow_version where workflow_id in (select id from workflow where owner_user_id = any($1))",
  );
  await q("delete from workflow where owner_user_id = any($1)");
  await q(
    "delete from discussion_member where discussion_id in (select id from discussion where owner_user_id = any($1))",
  );
  for (const t of [
    "turn_step",
    "discussion_turn",
    "discussion",
    "inbound_event",
    "inbound_thread",
    "inbound_route",
    "bot_peer",
  ])
    await q(`delete from ${t} where owner_user_id = any($1)`);
  for (const t of [
    "task",
    "agenda_item",
    "agenda_sync",
    "memory",
    "instruction",
    "attention_item",
    "goal_loop",
    "message",
    "conversation",
  ])
    await q(`delete from ${t} where owner_user_id = any($1)`);
  // Bot databases: each test bot may own a schema and a LOGIN role (modules/bot-database).
  for (const { schema_name: s } of (
    await q(
      "select schema_name from bot_database where bot_id in (select id from bot where owner_user_id = any($1))",
    )
  ).rows as { schema_name: string }[]) {
    if (!/^[a-z][a-z0-9_]{0,58}_bot$/.test(s)) continue;
    await db.$client.query(
      "select pg_terminate_backend(pid) from pg_stat_activity where usename = $1",
      [s],
    );
    await db.$client.query(`drop schema if exists "${s}" cascade`);
    if ((await db.$client.query("select 1 from pg_roles where rolname = $1", [s])).rowCount) {
      await db.$client.query(`drop owned by "${s}"`);
      await db.$client.query(`drop role "${s}"`);
    }
  }
  await q(
    "delete from bot_database where bot_id in (select id from bot where owner_user_id = any($1))",
  );
  await q(
    "delete from bot_claude_asset where bot_id in (select id from bot where owner_user_id = any($1))",
  );
  await q(
    "delete from bot_claude_config where bot_id in (select id from bot where owner_user_id = any($1))",
  );
  await q(
    "delete from bot_revision where bot_id in (select id from bot where owner_user_id = any($1))",
  );
  await q(
    "delete from team_member where team_id in (select id from team where owner_user_id = any($1))",
  );
  await q("delete from team where owner_user_id = any($1)");
  await q("delete from bot where owner_user_id = any($1)");
  await q("delete from workspace where owner_user_id = any($1)");
  await q("delete from connection where owner_user_id = any($1)");
  await q("delete from membership where user_id = any($1)");
  await q('delete from "user" where id = any($1)');
}
