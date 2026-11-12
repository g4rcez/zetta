/** Tool blocks the server runs (apps/server/src/modules/chat/tools.ts parseTools). `zetta:ui`, `zetta:whatsapp`, `zetta:app.linkto` and the server-built `zetta:setup-card` and `zetta:inbound-card` are drawn, so they stay. `zetta:plan` runs nothing, but the checklist shows it instead. */
const KINDS =
  "remember|instruction|config|browser|handoff|create_bot|create_team|add_to_team|create_routine|create_workflow|create_vm|mcp|plugin|desktop|credential|agenda|discussion|bot_claude|permission|goal_progress|goal_done|goal_stop|next_wave|goal|team_goals|assign|artifact|playground|app|memory|memory_admin|wiki|task|escalate|setup|inbound|skills|bot|folder|workspace|routine|team|output_style|artifacts|plugins|mcp_server|skill_library|hook|claude|room|bot_database|preferences|conversation|attention|workflow|computer|snapshot|source|company_docs|connection|agenda_sync|wiki_admin|browser_profile|decision|inbound_route|admin|import_bot|plan|poll";
const CLOSED = new RegExp("```zetta:(?:" + KINDS + ")\\s*\\n[\\s\\S]*?```", "g");
// `.` ends a kind name: `zetta:app.linkto` is a card, not the `zetta:app` tool, so a finished one stays and the card is drawn.
const OPEN = new RegExp("```zetta:(?:" + KINDS + ")(?![a-z_.-])[\\s\\S]*$");
/** A link card still being written has no JSON worth showing yet; a finished one is not matched (it holds its closing fence). */
const OPEN_LINK = /```zetta:app\.linkto(?:(?!```)[\s\S])*$/;

/** While a reply streams, hides the tool blocks (finished or still being written): the activity line says what is running instead of a JSON dump. */
export const stripToolFences = (text: string) =>
  text.replace(CLOSED, "").replace(OPEN, "").replace(OPEN_LINK, "").trimEnd();
