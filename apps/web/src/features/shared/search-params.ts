/** Readers for route search params (`validateSearch`): anything that is not understood is dropped. */
const UUID = /^[0-9a-f-]{36}$/i;

export const isUuid = (v: unknown): v is string => typeof v === "string" && UUID.test(v);

/** A trimmed text of at most `max` characters; `undefined` when it is not a string or is empty. */
export const searchText = (v: unknown, max: number) => {
  const t = typeof v === "string" ? v.trim().slice(0, max) : "";
  return t || undefined;
};
