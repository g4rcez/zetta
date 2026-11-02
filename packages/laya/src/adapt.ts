/** The parts that differ between checkpoints, as pure functions: calibration config and act head. */
import { softmax } from "./sequence";
import type { LayaConfig } from "./types";
import type { LayaVariant } from "./variants";
import { VARIANTS } from "./variants";

const isNumber = (v: unknown): v is number => typeof v === "number" && Number.isFinite(v);

/** The calibration config of a checkpoint, in the shape `systemOne` reads. */
export function normalizeConfig(variant: LayaVariant, raw: unknown): LayaConfig {
  const section = VARIANTS[variant].config.section;
  const source = (section ? (raw as Record<string, unknown> | null)?.[section] : raw) as
    | Partial<LayaConfig>
    | undefined;
  const t = source?.temperature;
  if (
    !source ||
    !isNumber(source.max_len) ||
    !isNumber(source.head_max_len) ||
    !Array.isArray(t) ||
    t.length !== 3
  )
    throw new Error(
      `invalid ${variant} config: expected max_len, head_max_len and a 3-value temperature${section ? ` under "${section}"` : ""}`,
    );
  return {
    max_len: source.max_len,
    head_max_len: source.head_max_len,
    temperature: [t[0], t[1], t[2]] as LayaConfig["temperature"],
    ...(source.temperature_by_options
      ? { temperature_by_options: source.temperature_by_options }
      : {}),
  };
}

/** `logits` must be float32 (the fp16 graph returns float16 and is not supported). */
export function floatLogits(data: unknown): Float32Array {
  if (!(data instanceof Float32Array))
    throw new Error("unexpected model output: logits must be float32");
  return data;
}

/**
 * One act probability per row. `act_probs` is used as it is (first column). `act_logits` goes through a softmax first.
 * Zetta does not use it; it keeps the Jev-shaped `rl_agent.act_probability` field filled.
 */
export function actProbabilities(
  output: "act_probs" | "act_logits",
  tensor: { data: unknown; dims: readonly number[] } | undefined,
  rows: number,
): number[] {
  if (!tensor || !(tensor.data instanceof Float32Array))
    throw new Error(`unexpected model output: ${output} must be float32`);
  const width = tensor.dims[1] ?? 1;
  const data = tensor.data;
  return Array.from({ length: rows }, (_, r) => {
    const row = Array.from(data.subarray(r * width, (r + 1) * width));
    return output === "act_probs" ? (row[0] ?? 0) : (softmax(row)[0] ?? 0);
  });
}
