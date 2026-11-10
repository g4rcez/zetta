/** The Postgres SQLSTATE of a driver error, read from the error or from its direct cause (Drizzle wraps the driver error). */
export const sqlstate = (e: unknown) =>
  (e as { code?: string; cause?: { code?: string } })?.code ??
  (e as { cause?: { code?: string } })?.cause?.code;

/** True when the error, or its direct cause, is a unique violation (23505) on any constraint. */
export const hasUniqueViolation = (e: unknown) =>
  [e, (e as { cause?: unknown } | null)?.cause].some(
    (x) => (x as { code?: string } | null)?.code === "23505",
  );
