/** Harnesses Zetta can run a bot on, and the models each one may be asked for. Shared by the web app (select options) and the server (validation). */
export const HARNESSES = ["fixture", "claude-code", "codex", "pi", "omp", "opencode", "cursor"] as const;
export type Harness = (typeof HARNESSES)[number];

type ModelOption = { value: string; label: string };
/** Models each harness may run, passed to its CLI as `--model`. Empty value = the harness's own default. */
export const HARNESS_MODELS: Record<Harness, ModelOption[]> = {
  fixture: [],
  "claude-code": [
    { value: "claude-opus-5-5", label: "Opus 5.5 · most capable" },
    { value: "claude-sonnet-5-5", label: "Sonnet 5.5 · balanced" },
    { value: "claude-haiku-5-5", label: "Haiku 5.5 · fast and cheap" },
    { value: "claude-fable-5-1", label: "Fable 5.1" },
    { value: "opus", label: "Latest Opus (alias)" },
    { value: "sonnet", label: "Latest Sonnet (alias)" },
    { value: "haiku", label: "Latest Haiku (alias)" },
  ],
  codex: [
    { value: "gpt-5-codex", label: "GPT-5 Codex" },
    { value: "gpt-5", label: "GPT-5" },
    { value: "gpt-5-mini", label: "GPT-5 mini" },
  ],
  pi: [
    { value: "anthropic/claude-sonnet-5-5", label: "Anthropic · Sonnet 5.5" },
    { value: "anthropic/claude-haiku-5-5", label: "Anthropic · Haiku 5.5" },
    { value: "openai/gpt-5", label: "OpenAI · GPT-5" },
  ],
  omp: [
    { value: "anthropic/claude-sonnet-5-5", label: "Anthropic · Sonnet 5.5" },
    { value: "anthropic/claude-haiku-5-5", label: "Anthropic · Haiku 5.5" },
    { value: "openai/gpt-5", label: "OpenAI · GPT-5" },
  ],
  opencode: [
    { value: "anthropic/claude-sonnet-5-5", label: "Anthropic · Sonnet 5.5" },
    { value: "anthropic/claude-opus-5-5", label: "Anthropic · Opus 5.5" },
    { value: "openai/gpt-5", label: "OpenAI · GPT-5" },
  ],
  cursor: [
    { value: "auto", label: "Auto" },
    { value: "sonnet-4.5", label: "Claude Sonnet 4.5" },
    { value: "gpt-5", label: "GPT-5" },
  ],
};

/** Select options for a harness's models; a saved model outside the list is kept so editing never silently drops it. */
export const modelOptions = (harness: string, current?: string | null): ModelOption[] => {
  const list = HARNESS_MODELS[harness as keyof typeof HARNESS_MODELS] ?? [];
  const extra = current && !list.some((m) => m.value === current) ? [{ value: current, label: current }] : [];
  return [{ value: "", label: "Harness default" }, ...list, ...extra];
};
/** Empty or null means "harness default" and is always allowed; the offline fixture takes no model at all. */
export const isAllowedModel = (harness: string, model: string | null | undefined) => !model || (HARNESS_MODELS[harness as keyof typeof HARNESS_MODELS] ?? []).some((m) => m.value === model);
