/** Same values as the server (packages/db/src/schema/preferences.ts), which rejects anything else. */
export const TIME_FORMATS = ["24h", "12h"] as const;
export type TimeFormat = (typeof TIME_FORMATS)[number];
export const DEFAULT_TIME_FORMAT: TimeFormat = "24h";
export const TIME_FORMAT_LABEL: Record<TimeFormat, string> = { "24h": "24-hour", "12h": "12-hour" };

// `hourCycle` (not `hour12`) so 24h shows 00:30 and never 24:30 in any locale.
const cycle = (f: TimeFormat) => ({ hourCycle: f === "12h" ? "h12" : "h23" }) as const;

type Input = Date | string | number;

/** The hour of day, in the person's chosen format. Pass `options` to change which parts show. */
export const formatTime = (
  value: Input,
  f: TimeFormat,
  options: Intl.DateTimeFormatOptions = {
    hour: f === "12h" ? "numeric" : "2-digit",
    minute: "2-digit",
  },
) => new Date(value).toLocaleTimeString(undefined, { ...options, ...cycle(f) });

// `toLocaleString` with options builds a new Intl.DateTimeFormat on every call (about 15 µs), and tooltips format once per rendered row.
// These are the fields `toLocaleString` shows by default, so the result is the same.
const dateTimeFormats: Partial<Record<TimeFormat, Intl.DateTimeFormat>> = {};
const defaultDateTime = (f: TimeFormat) =>
  (dateTimeFormats[f] ??= new Intl.DateTimeFormat(undefined, {
    year: "numeric",
    month: "numeric",
    day: "numeric",
    hour: "numeric",
    minute: "numeric",
    second: "numeric",
    ...cycle(f),
  }));

/** Date and hour, in the person's chosen format. */
export const formatDateTime = (
  value: Input,
  f: TimeFormat,
  options?: Intl.DateTimeFormatOptions,
) => {
  const date = new Date(value);
  // `Intl.DateTimeFormat.format` throws on an invalid date; `toLocaleString` returns "Invalid Date".
  return options || Number.isNaN(date.getTime())
    ? date.toLocaleString(undefined, { ...options, ...cycle(f) })
    : defaultDateTime(f).format(date);
};
