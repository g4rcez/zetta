/** Tool blocks the server runs (apps/server/src/modules/chat/tools.ts parseTools). `zetta:ui`, `zetta:whatsapp` and the server-built `zetta:setup-card` and `zetta:inbound-card` are drawn, so they stay. `zetta:plan` runs nothing, but the checklist shows it instead. */
const KINDS =
  "remember|instruction|config|browser|handoff|create_bot|create_team|add_to_team|create_routine|create_workflow|create_vm|mcp|plugin|desktop|credential|agenda|discussion|bot_claude|permission|goal_progress|goal_done|goal_stop|goal|team_goals|artifact|wiki|task|escalate|setup|inbound|skills|bot|folder|workspace|routine|team|output_style|artifacts|plugins|mcp_server|skill_library|hook|claude|room|bot_database|preferences|conversation|attention|workflow|computer|snapshot|source|company_docs|connection|agenda_sync|wiki_admin|browser_profile|decision|inbound_route|admin|plan";
const CLOSED = new RegExp("```zetta:(?:" + KINDS + ")\\s*\\n[\\s\\S]*?```", "g");
const OPEN = new RegExp("```zetta:(?:" + KINDS + ")(?![a-z_-])[\\s\\S]*$");

/** While a reply streams, hides the tool blocks (finished or still being written): the activity line says what is running instead of a JSON dump. */
export const stripToolFences = (text: string) =>
  text.replace(CLOSED, "").replace(OPEN, "").trimEnd();
