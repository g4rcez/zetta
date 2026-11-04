const UNITS: [Intl.RelativeTimeFormatUnit, number][] = [
  ["year", 31_536_000_000],
  ["month", 2_592_000_000],
  ["day", 86_400_000],
  ["hour", 3_600_000],
  ["minute", 60_000],
];

const formats = new Map<string, Intl.RelativeTimeFormat>();
const format = (locale: string | undefined, numeric: "auto" | "always") => {
  const key = `${locale ?? ""}:${numeric}`;
  let rtf = formats.get(key);
  if (!rtf)
    formats.set(key, (rtf = new Intl.RelativeTimeFormat(locale, { style: "narrow", numeric })));
  return rtf;
};

/**
 * The one format for "how long ago" and "how long until": `5m ago`, `3h ago`, `yesterday`, `3mo ago`, `in 3h`.
 * Only days read as words (`yesterday`, `tomorrow`); the rest stay numeric. It rounds toward now, so 59 minutes is never an hour.
 * Under a minute reads `now`, so a countdown never flickers through seconds. An unreadable date reads `now` too.
 */
export function relativeTime(iso: string, now = Date.now(), locale?: string) {
  const diff = new Date(iso).getTime() - now;
  const unit = UNITS.find(([, ms]) => Math.abs(diff) >= ms);
  if (!unit) return "now";
  return format(locale, unit[0] === "day" ? "auto" : "always").format(
    Math.trunc(diff / unit[1]),
    unit[0],
  );
}
