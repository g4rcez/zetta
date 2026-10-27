import { z } from "zod";
import { PLUGIN_NAME, type ClaudePreset, type AgentProfile } from "../chat/harness";

/** What people can pick for "what may this bot do with code". `auto` keeps the original behaviour, so a bot without settings is unchanged. */
export const PRESETS: { id: ClaudePreset; title: string; description: string }[] = [
  {
    id: "auto",
    title: "Standard",
    description: "Read and edit files and run git. Inside a container it may run any command.",
  },
  {
    id: "read_only",
    title: "Read only",
    description: "Read files and look at git history. It cannot change anything.",
  },
  {
    id: "edit",
    title: "Edit files",
    description: "Read and edit files. No commands at all, not even git.",
  },
  {
    id: "git",
    title: "Files and git",
    description: "Read and edit files and run git. Never other commands, even inside a container.",
  },
  {
    id: "full",
    title: "Any command",
    description:
      "Run any command. Only takes effect inside a container; on the host it falls back to files and git.",
  },
];
/** Hermes cannot narrow a shell to git, so its presets are about toolsets: web, file tools, and (container only) commands and code. */
const HERMES_TEXT: Record<ClaudePreset, string> = {
  auto: "Web search and file tools. Inside a container it may also run commands and code.",
  read_only: "Web only. It cannot touch files or run anything.",
  edit: "Web and file tools. No commands.",
  git: "Web and file tools. Hermes cannot limit a shell to git, so there are no commands.",
  full: "Also commands and code. Only takes effect inside a container; on the host it falls back to web and file tools.",
};
export const presetsFor = (harness: string) =>
  harness === "hermes" ? PRESETS.map((p) => ({ ...p, description: HERMES_TEXT[p.id] })) : PRESETS;
export const LIMITS = {
  assetsPerKind: 25,
  body: 24_000,
  description: 600,
  prompt: 8_000,
  rules: 40,
  rule: 200,
  budgetCents: 10_000,
} as const;
export const EFFORTS = ["low", "medium", "high", "xhigh", "max"] as const;
export const MODELS = ["inherit", "sonnet", "opus", "haiku"] as const;

/** A permission rule as the CLI reads it: `Tool` or `Tool(pattern)`. No line breaks, no nested parentheses. */
const rule = z
  .string()
  .trim()
  .max(LIMITS.rule)
  .regex(
    /^[A-Za-z][A-Za-z0-9_-]{0,63}(\([^()\r\n]{1,200}\))?$/,
    "Use a tool name like WebFetch, or a rule like Bash(npm test:*).",
  );
const rules = z
  .array(rule)
  .max(LIMITS.rules)
  .transform((l) => [...new Set(l)]);

export const configInput = z.strictObject({
  preset: z.enum(["auto", "read_only", "edit", "git", "full"]),
  allow: rules,
  deny: rules,
  appendPrompt: z.string().max(LIMITS.prompt),
  effort: z.enum(EFFORTS).nullable(),
  maxBudgetCents: z.number().int().min(1).max(LIMITS.budgetCents).nullable(),
});
export type ConfigInput = z.infer<typeof configInput>;

// Skills and sub-agents are text the owner wrote. Shell injection (!`cmd`) in a skill runs commands while the skill loads, outside the permission rules.
const noInjection = (s: string) => !/!`|```\s*!/.test(s);
const toolName = z
  .string()
  .trim()
  .regex(/^[A-Za-z][A-Za-z0-9_]{0,63}$/, "Tools are plain names such as Read or WebFetch.");
export const assetInput = z.strictObject({
  kind: z.enum(["skill", "agent"]),
  name: z
    .string()
    .trim()
    .regex(
      /^[a-z][a-z0-9-]{0,62}$/,
      "Use lowercase letters, numbers and dashes, starting with a letter.",
    ),
  description: z.string().trim().min(1, "Say when this should be used.").max(LIMITS.description),
  body: z
    .string()
    .trim()
    .min(1, "The instructions are empty.")
    .max(LIMITS.body)
    .refine(noInjection, "Shell commands inside the instructions (!`...`) are not allowed."),
  tools: z
    .array(toolName)
    .max(30)
    .default([])
    .transform((l) => [...new Set(l)]),
  model: z.enum(MODELS).nullable().default(null),
  enabled: z.boolean().default(true),
});
export type AssetInput = z.infer<typeof assetInput>;
export type Asset = AssetInput & { id: string };
export type Config = ConfigInput;

export const DEFAULT_CONFIG: Config = {
  preset: "auto",
  allow: [],
  deny: [],
  appendPrompt: "",
  effort: null,
  maxBudgetCents: null,
};

/** Frontmatter values are written as JSON strings (valid YAML), so a description can never add keys or end the block. */
const front = (pairs: [string, string | undefined][]) =>
  `---\n${pairs
    .filter(([, v]) => v !== undefined)
    .map(([k, v]) => `${k}: ${v}`)
    .join("\n")}\n---\n\n`;
export function pluginFiles(assets: readonly Asset[]): Record<string, string> {
  const live = assets.filter((a) => a.enabled);
  if (!live.length) return {};
  const files: Record<string, string> = {
    ".claude-plugin/plugin.json": JSON.stringify({
      name: PLUGIN_NAME,
      version: "1.0.0",
      description: "Skills and agents installed for this bot in Zetta.",
    }),
  };
  for (const a of live) {
    if (a.kind === "skill")
      files[`skills/${a.name}/SKILL.md`] = `${front([
        ["name", JSON.stringify(a.name)],
        ["description", JSON.stringify(a.description)],
      ])}${a.body}\n`;
    else
      files[`agents/${a.name}.md`] = `${front([
        ["name", JSON.stringify(a.name)],
        ["description", JSON.stringify(a.description)],
        ["tools", a.tools.length ? JSON.stringify(a.tools.join(", ")) : undefined],
        ["model", a.model && a.model !== "inherit" ? a.model : undefined],
      ])}${a.body}\n`;
  }
  return files;
}

/** The profile a run uses, or undefined when the bot has no settings at all (the harness then behaves exactly as before). */
export function buildProfile(
  config: Config | undefined,
  assets: readonly Asset[],
): AgentProfile | undefined {
  const files = pluginFiles(assets);
  if (!config && !Object.keys(files).length) return undefined;
  const c = config ?? DEFAULT_CONFIG;
  return {
    preset: c.preset,
    allow: c.allow,
    deny: c.deny,
    appendPrompt: c.appendPrompt.trim(),
    effort: c.effort,
    maxBudgetCents: c.maxBudgetCents,
    files,
    skills: assets
      .filter((a) => a.enabled && a.kind === "skill")
      .map((a) => ({ name: a.name, description: a.description, body: a.body })),
  };
}
