import type { Database } from "@zetta/db";

/**
 * Empties the company chart: seats that nobody reports to first (a seat cannot be deleted while another one reports to it), then the chart.
 * A chart left behind would add its text to the prompt of every later test, so a test that draws one calls this when it is done.
 */
export async function resetOrgChart(db: Database) {
  for (let i = 0; i < 20; i++) {
    const r = await db.$client.query(
      "delete from org_position p where not exists (select 1 from org_position c where c.parent_id = p.id)",
    );
    if (!r.rowCount) break;
  }
  await db.$client.query("delete from org_chart");
}

/** Deletes everything owned by the given synthetic test users, in foreign-key-safe order. Test databases only. */
export async function cleanupTestUsers(db: Database, ids: string[]) {
  const q = (sql: string) => db.$client.query(sql, [ids]);
  await q(
    "delete from memory_suggestion where author_user_id = any($1) or page_owner_user_id = any($1)",
  );
  // The company chart: a seat held by a test user or bot, or linked to a test team, goes back to open.
  await q(
    "update org_position set seat = 'open', user_id = null, bot_id = null where user_id = any($1) or bot_id in (select id from bot where owner_user_id = any($1))",
  );
  await q(
    "update org_position set team_id = null where team_id in (select id from team where owner_user_id = any($1))",
  );
  await q("update org_chart set updated_by_user_id = null where updated_by_user_id = any($1)");
  // Members, and the project links of tasks and rooms, go with the project (cascade / set null).
  await q("delete from project where owner_user_id = any($1)");
  for (const t of [
    "item_use",
    "reply_outcome",
    "learning_finding",
    "bot_lesson",
    "learning_run",
    "learning_policy",
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
