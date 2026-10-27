import { call } from "../chat/chat-client";

export type ClaudePreset = "auto" | "read_only" | "edit" | "git" | "full";
export type ClaudeConfig = {
  preset: ClaudePreset;
  allow: string[];
  deny: string[];
  appendPrompt: string;
  effort: string | null;
  maxBudgetCents: number | null;
};
export type ClaudeAsset = {
  id: string;
  kind: "skill" | "agent";
  name: string;
  description: string;
  body: string;
  tools: string[];
  model: string | null;
  enabled: boolean;
};
export type ClaudeAssetInput = Omit<ClaudeAsset, "id">;
export type ClaudeSettings = {
  config: ClaudeConfig;
  assets: ClaudeAsset[];
  harness: string;
  /** True when runs happen in a container, where "Any command" and custom command rules take effect. */
  container: boolean;
  options: {
    presets: { id: ClaudePreset; title: string; description: string }[];
    efforts: string[];
    models: string[];
    limits: {
      assetsPerKind: number;
      body: number;
      description: number;
      prompt: number;
      rules: number;
      budgetCents: number;
    };
  };
};

const base = (botId: string) => `/api/bots/${botId}/claude`;
export const claudeApi = {
  get: (botId: string) => call<ClaudeSettings>(base(botId)),
  save: (botId: string, config: ClaudeConfig) =>
    call<{ config: ClaudeConfig }>(base(botId), "PUT", config).then((r) => r.config),
  addAsset: (botId: string, a: ClaudeAssetInput) =>
    call<{ asset: ClaudeAsset }>(`${base(botId)}/assets`, "POST", a).then((r) => r.asset),
  updateAsset: (botId: string, id: string, a: ClaudeAssetInput) =>
    call<{ asset: ClaudeAsset }>(`${base(botId)}/assets/${id}`, "PUT", a).then((r) => r.asset),
  removeAsset: (botId: string, id: string) => call(`${base(botId)}/assets/${id}`, "DELETE"),
};

/** One rule per line in the form, a list on the wire. */
export const toRules = (text: string) =>
  text
    .split("\n")
    .map((l) => l.trim())
    .filter(Boolean);

/**
 * Reads a pasted SKILL.md or agent .md: simple `key: value` frontmatter (name, description, tools, model) and the body after it.
 * Anything else in the frontmatter is dropped, because the server only keeps those fields.
 */
export function parseMarkdown(text: string) {
  const m = /^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/.exec(text.trim());
  if (!m)
    return { body: text.trim() } as {
      name?: string;
      description?: string;
      tools?: string[];
      model?: string;
      body: string;
    };
  const out: {
    name?: string;
    description?: string;
    tools?: string[];
    model?: string;
    body: string;
  } = { body: m[2]!.trim() };
  for (const line of m[1]!.split(/\r?\n/)) {
    const kv = /^([A-Za-z-]+):\s*(.*)$/.exec(line);
    if (!kv) continue;
    const value = kv[2]!.trim().replace(/^(["'])(.*)\1$/, "$2");
    if (kv[1] === "name") out.name = value;
    else if (kv[1] === "description") out.description = value;
    else if (kv[1] === "model") out.model = value;
    else if (kv[1] === "tools")
      out.tools = value
        .split(",")
        .map((t) => t.trim())
        .filter(Boolean);
  }
  return out;
}
