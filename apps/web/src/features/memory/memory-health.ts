/** The slugs a job result names: "saved: acme-billing, gotcha-x". Anything else (a skip code, a note) names none. */
export function savedSlugs(result: string): string[] {
  const m = /^saved: (.+)$/.exec(result.trim());
  return m
    ? m[1]!
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean)
    : [];
}
