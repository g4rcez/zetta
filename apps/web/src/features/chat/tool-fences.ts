/** Tool blocks the server runs (apps/server/src/modules/chat/tools.ts parseTools). `zetta:ui` and `zetta:whatsapp` are drawn, so they stay. */
const KINDS =
  "remember|instruction|config|browser|handoff|create_bot|create_team|add_to_team|create_routine|create_workflow|create_vm|mcp|plugin|desktop|credential|agenda|discussion|bot_claude|permission|goal_progress|goal_done|goal|team_goals|artifact";
const CLOSED = new RegExp("```zetta:(?:" + KINDS + ")\\s*\\n[\\s\\S]*?```", "g");
const OPEN = new RegExp("```zetta:(?:" + KINDS + ")(?![a-z_])[\\s\\S]*$");

/** While a reply streams, hides the tool blocks (finished or still being written): the activity line says what is running instead of a JSON dump. */
export const stripToolFences = (text: string) =>
  text.replace(CLOSED, "").replace(OPEN, "").trimEnd();
