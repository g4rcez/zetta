const keyLine = (key: string) => new RegExp(`^${key}=(.*)$`, "m");

/** The value of `KEY=` in a .env text, or `undefined` when the key is missing. */
export function readEnv(text: string, key: string): string | undefined {
  return keyLine(key).exec(text)?.[1]?.trim();
}

/** Replaces `KEY=` lines in place and appends the missing keys. Comments and unknown lines stay; no line is deleted. */
export function upsertEnv(text: string, values: Readonly<Record<string, string>>): string {
  let out = text;
  for (const [key, value] of Object.entries(values)) {
    const line = `${key}=${value}`;
    out = keyLine(key).test(out)
      ? out.replace(keyLine(key), () => line)
      : `${out}${out === "" || out.endsWith("\n") ? "" : "\n"}${line}\n`;
  }
  return out;
}
