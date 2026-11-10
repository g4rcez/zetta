import type { Database } from "@zetta/db";

/** Deletes everything owned by the given synthetic test users, in foreign-key-safe order. Test databases only. */
export async function cleanupTestUsers(db: Database, ids: string[]) {
  const q = (sql: string) => db.$client.query(sql, [ids]);
  await q(
    "delete from memory_suggestion where author_user_id = any($1) or page_owner_user_id = any($1)",
  );
  for (const t of [
    "memory_job",
    "memory_source",
    "memory_revision",
    "memory_item",
    "knowledge_doc",
    "knowledge_source",
    "audit_event",
    "reaction",
    "attachment",
    "delegation",
    "routine_run",
    "routine_trigger",
    "workflow_run",
    "snapshot",
    "config_proposal",
    "hook",
    "decision_config",
    "bot_connection",
    "connection_user_key",
    "browser_profile",
    "computer_vm",
    "source",
    "artifact",
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
    "attention_item",
    "goal_loop",
    "message",
    "conversation",
  ])
    await q(`delete from ${t} where owner_user_id = any($1)`);
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
    "delete from team_person where user_id = any($1) or team_id in (select id from team where owner_user_id = any($1))",
  );
  await q(
    "delete from team_member where team_id in (select id from team where owner_user_id = any($1))",
  );
  await q("delete from team where owner_user_id = any($1)");
  await q("delete from team_role where owner_user_id = any($1)");
  await q(
    "delete from skill_revision where skill_id in (select id from skill where owner_user_id = any($1)) or saved_by_user_id = any($1)",
  );
  await q(
    "delete from skill_use where bot_id in (select id from bot where owner_user_id = any($1)) or skill_id in (select id from skill where owner_user_id = any($1))",
  );
  await q(
    "delete from bot_skill where bot_id in (select id from bot where owner_user_id = any($1)) or skill_id in (select id from skill where owner_user_id = any($1))",
  );
  // Apps: the calls, then the grants, then the versions the apps point to, then the apps (a team app may hold calls by another test user).
  const apps = "select id from app where owner_user_id = any($1)";
  await q(`delete from app_record where user_id = any($1) or app_id in (${apps})`);
  await q(`delete from app_call where actor_user_id = any($1) or app_id in (${apps})`);
  await q(
    `delete from bot_app where bot_id in (select id from bot where owner_user_id = any($1)) or app_id in (${apps})`,
  );
  await q("update app set active_version_id = null where owner_user_id = any($1)");
  await q(`delete from app_version where app_id in (${apps}) or published_by_user_id = any($1)`);
  await q("delete from app where owner_user_id = any($1)");
  // A team playground may hold runs by another test user, so runs go by playground or actor.
  const mine = "select id from playground where owner_user_id = any($1)";
  const runs = `select id from playground_run where actor_user_id = any($1) or playground_id in (${mine})`;
  await q(`delete from playground_run_output where run_id in (${runs})`);
  await q(`delete from playground_run where id in (${runs})`);
  await q(`delete from playground_file where playground_id in (${mine})`);
  await q("delete from playground where owner_user_id = any($1)");
  await q("delete from task where assignee_user_id = any($1)");
  await q("delete from approval_rule where owner_user_id = any($1)");
  await q("delete from skill_review where owner_user_id = any($1)");
  await q("delete from bot where owner_user_id = any($1)");
  await q(
    "delete from skill_file where skill_id in (select id from skill where owner_user_id = any($1))",
  );
  await q("delete from skill where owner_user_id = any($1)");
  // After the bots: a bot may point to a style that another test user owns.
  await q("delete from output_style where owner_user_id = any($1)");
  await q("delete from folder where owner_user_id = any($1)");
  await q("delete from connection where owner_user_id = any($1)");
  await q("delete from membership where user_id = any($1)");
  await q('delete from "user" where id = any($1)');
}
