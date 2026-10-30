/** Which tools of a bound server a bot may call: all of them, or only the names the user picked. */
export type ToolAccess = { toolsMode: "all" | "selected"; allowedTools: string[] };

export const toolAllowed = (access: ToolAccess, tool: string) =>
  access.toolsMode === "all" || access.allowedTools.includes(tool);
