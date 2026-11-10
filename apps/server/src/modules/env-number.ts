/**
 * A number read from an environment variable. An unset, blank, non-numeric or too small value (`min`, default 1) gives `fallback`, so an
 * empty line in a `.env` file (`ZETTA_X=`) means "use the default" and never `Number("")`, which is 0. Pass `min: 0` where 0 is a real choice.
 */
export const envNumber = (raw: string | undefined, fallback: number, min = 1): number => {
  const n = raw?.trim() ? Number(raw) : Number.NaN;
  return Number.isFinite(n) && n >= min ? n : fallback;
};
