/**
 * A small RFC 5545 reader for calendar feeds (ICS): the events that fall inside a time window, recurring ones expanded.
 *
 * Written here instead of pulling in a library: the feed is read-only, the window is bounded, and the pieces calendars really publish are
 * few. Supported: VEVENT with SUMMARY, DTSTART, DTEND or DURATION (timed, all-day, UTC, floating and TZID times, also Windows zone names),
 * LOCATION, DESCRIPTION, STATUS; RRULE with FREQ DAILY, WEEKLY, MONTHLY and YEARLY, INTERVAL, COUNT, UNTIL, BYDAY (also with an
 * ordinal such as 2MO or -1FR), BYMONTHDAY, BYMONTH, BYSETPOS and WKST; EXDATE, RDATE and RECURRENCE-ID overrides (a moved or cancelled
 * single occurrence). Not supported: FREQ below DAILY, BYHOUR and similar time rules, BYWEEKNO, BYYEARDAY; such a rule is expanded on its
 * other parts. VTODO, VJOURNAL and VALARM are ignored.
 *
 * Everything in a feed is text somebody else wrote: the caller frames it as untrusted data. Nothing here runs or follows it.
 */
export type IcsEvent = {
  uid: string;
  title: string;
  start: Date;
  end: Date | null;
  /** Date-only event. `start` is that date at 00:00 UTC and `end` the exclusive end date, like the Agenda stores them. */
  allDay: boolean;
  location: string;
  description: string;
  recurring: boolean;
  /** The IANA zone the feed gave the event, when it did. */
  timezone: string | null;
};
export type IcsWindow = { from: Date; to: Date };
export type IcsResult = { name: string; events: IcsEvent[]; cut: boolean };

const MAX_OCCURRENCES_SCANNED = 20_000;
const DAY = 86_400_000;

type Prop = { name: string; params: Record<string, string>; value: string };

const unescapeText = (v: string) =>
  v.replace(/\\([nN,;\\])/g, (_, c: string) => (c === "n" || c === "N" ? "\n" : c));

function parseLine(line: string): Prop | undefined {
  // name *(";" param) ":" value. A colon inside a quoted parameter value does not end the name part.
  let inQuote = false,
    colon = -1;
  for (let i = 0; i < line.length; i++) {
    const ch = line[i];
    if (ch === '"') inQuote = !inQuote;
    else if (ch === ":" && !inQuote) {
      colon = i;
      break;
    }
  }
  if (colon < 1) return undefined;
  const head = line.slice(0, colon);
  const parts: string[] = [];
  let cur = "";
  inQuote = false;
  for (const ch of head) {
    if (ch === '"') inQuote = !inQuote;
    if (ch === ";" && !inQuote) {
      parts.push(cur);
      cur = "";
    } else cur += ch;
  }
  parts.push(cur);
  const params: Record<string, string> = {};
  for (const p of parts.slice(1)) {
    const eq = p.indexOf("=");
    if (eq > 0) params[p.slice(0, eq).toUpperCase()] = p.slice(eq + 1).replace(/^"|"$/g, "");
  }
  return { name: parts[0]!.toUpperCase(), params, value: line.slice(colon + 1) };
}

/** Windows zone names that calendars from Outlook and Exchange use, as IANA names. Unknown names fall back to the feed's own zone. */
const WINDOWS_ZONES: Record<string, string> = {
  UTC: "UTC",
  "Greenwich Standard Time": "Atlantic/Reykjavik",
  "GMT Standard Time": "Europe/London",
  "W. Europe Standard Time": "Europe/Berlin",
  "Central Europe Standard Time": "Europe/Budapest",
  "Romance Standard Time": "Europe/Paris",
  "Central European Standard Time": "Europe/Warsaw",
  "E. Europe Standard Time": "Europe/Chisinau",
  "GTB Standard Time": "Europe/Bucharest",
  "FLE Standard Time": "Europe/Kiev",
  "Russian Standard Time": "Europe/Moscow",
  "Turkey Standard Time": "Europe/Istanbul",
  "Eastern Standard Time": "America/New_York",
  "Central Standard Time": "America/Chicago",
  "Mountain Standard Time": "America/Denver",
  "US Mountain Standard Time": "America/Phoenix",
  "Pacific Standard Time": "America/Los_Angeles",
  "Alaskan Standard Time": "America/Anchorage",
  "Hawaiian Standard Time": "Pacific/Honolulu",
  "Atlantic Standard Time": "America/Halifax",
  "E. South America Standard Time": "America/Sao_Paulo",
  "Argentina Standard Time": "America/Buenos_Aires",
  "SA Pacific Standard Time": "America/Bogota",
  "India Standard Time": "Asia/Kolkata",
  "China Standard Time": "Asia/Shanghai",
  "Tokyo Standard Time": "Asia/Tokyo",
  "Korea Standard Time": "Asia/Seoul",
  "Singapore Standard Time": "Asia/Singapore",
  "AUS Eastern Standard Time": "Australia/Sydney",
  "New Zealand Standard Time": "Pacific/Auckland",
  "South Africa Standard Time": "Africa/Johannesburg",
  "Arab Standard Time": "Asia/Riyadh",
  "Israel Standard Time": "Asia/Jerusalem",
};
const zoneCache = new Map<string, Intl.DateTimeFormat | null>();
function formatter(tz: string) {
  let f = zoneCache.get(tz);
  if (f === undefined) {
    try {
      f = new Intl.DateTimeFormat("en-US", {
        timeZone: tz,
        hourCycle: "h23",
        year: "numeric",
        month: "numeric",
        day: "numeric",
        hour: "numeric",
        minute: "numeric",
        second: "numeric",
      });
    } catch {
      f = null;
    }
    zoneCache.set(tz, f);
  }
  return f;
}
/** An IANA zone name for a TZID, or undefined when it is not one this server knows. */
export function resolveZone(tzid: string | undefined, fallback?: string): string | undefined {
  const name = tzid?.replace(/^\//, "");
  for (const t of [name, name ? WINDOWS_ZONES[name] : undefined, fallback])
    if (t && formatter(t)) return t;
  return undefined;
}
/** The offset of `tz` from UTC at the instant `ms`, in milliseconds. */
function offsetAt(tz: string, ms: number) {
  const parts = Object.fromEntries(
    formatter(tz)!
      .formatToParts(new Date(ms))
      .map((p) => [p.type, Number(p.value)]),
  );
  const wall = Date.UTC(
    parts.year!,
    parts.month! - 1,
    parts.day!,
    parts.hour!,
    parts.minute!,
    parts.second!,
  );
  return wall - Math.floor(ms / 1000) * 1000;
}
/** The instant at which the wall clock of `tz` reads `wall` (a UTC-based stand-in for the clock). */
function wallToInstant(wall: number, tz: string | undefined) {
  if (!tz) return wall;
  let guess = wall - offsetAt(tz, wall);
  guess = wall - offsetAt(tz, guess); // a second pass settles times near a clock change
  return guess;
}

type Value = { ms: number; allDay: boolean; wall: number; tz: string | undefined };
/** One DTSTART, DTEND, EXDATE or similar value. `wall` is the clock reading as UTC; `ms` the instant. */
function parseDate(p: Prop, floating: string | undefined): Value | undefined {
  const m = /^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})(Z)?)?$/.exec(p.value.trim());
  if (!m) return undefined;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (m[4] === undefined || p.params.VALUE === "DATE") {
    const ms = Date.UTC(y, mo - 1, d);
    return { ms, allDay: true, wall: ms, tz: undefined };
  }
  const wall = Date.UTC(y, mo - 1, d, Number(m[4]), Number(m[5]), Number(m[6]));
  if (m[7]) return { ms: wall, allDay: false, wall, tz: undefined };
  const tz = resolveZone(p.params.TZID, floating);
  return { ms: wallToInstant(wall, tz), allDay: false, wall, tz };
}
/** An ISO 8601 duration in milliseconds (P1DT2H30M, PT45M, P2W). */
function parseDuration(v: string): number | undefined {
  const m = /^([+-])?P(?:(\d+)W)?(?:(\d+)D)?(?:T(?:(\d+)H)?(?:(\d+)M)?(?:(\d+)S)?)?$/.exec(
    v.trim(),
  );
  if (!m) return undefined;
  const n = (i: number) => Number(m[i] ?? 0);
  const ms = (n(2) * 7 + n(3)) * DAY + n(4) * 3_600_000 + n(5) * 60_000 + n(6) * 1000;
  return m[1] === "-" ? -ms : ms;
}

type Rule = {
  freq: "DAILY" | "WEEKLY" | "MONTHLY" | "YEARLY";
  interval: number;
  count?: number;
  until?: number;
  byDay: { n: number; wd: number }[];
  byMonthDay: number[];
  byMonth: number[];
  bySetPos: number[];
  wkst: number;
};
const WD = { SU: 0, MO: 1, TU: 2, WE: 3, TH: 4, FR: 5, SA: 6 } as const;
function parseRule(value: string, floating: string | undefined): Rule | undefined {
  const parts = Object.fromEntries(
    value.split(";").map((kv) => {
      const i = kv.indexOf("=");
      return [kv.slice(0, i).toUpperCase(), kv.slice(i + 1)];
    }),
  ) as Record<string, string>;
  const freq = parts.FREQ as Rule["freq"];
  if (!["DAILY", "WEEKLY", "MONTHLY", "YEARLY"].includes(freq)) return undefined;
  const ints = (v: string | undefined) =>
    (v ?? "")
      .split(",")
      .filter((x) => x.trim() !== "")
      .map(Number)
      .filter((n) => Number.isInteger(n) && n !== 0);
  const byDay = (parts.BYDAY ?? "")
    .split(",")
    .map((x) => /^([+-]?\d{1,2})?(SU|MO|TU|WE|TH|FR|SA)$/.exec(x.trim().toUpperCase()))
    .filter((m): m is RegExpExecArray => Boolean(m))
    .map((m) => ({ n: m[1] ? Number(m[1]) : 0, wd: WD[m[2] as keyof typeof WD] }));
  let until: number | undefined;
  if (parts.UNTIL) {
    const u = parseDate({ name: "UNTIL", params: {}, value: parts.UNTIL }, floating);
    // A date-only UNTIL is inclusive of that whole day.
    until = u ? (u.allDay ? u.ms + DAY - 1 : u.ms) : undefined;
  }
  return {
    freq,
    interval: Math.max(1, Number(parts.INTERVAL) || 1),
    ...(parts.COUNT && Number(parts.COUNT) > 0 ? { count: Math.floor(Number(parts.COUNT)) } : {}),
    ...(until !== undefined ? { until } : {}),
    byDay,
    byMonthDay: ints(parts.BYMONTHDAY),
    byMonth: ints(parts.BYMONTH),
    bySetPos: ints(parts.BYSETPOS),
    wkst:
      parts.WKST && parts.WKST.toUpperCase() in WD
        ? WD[parts.WKST.toUpperCase() as keyof typeof WD]
        : 1,
  };
}

const daysIn = (y: number, m: number) => new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
const weekday = (y: number, m: number, d: number) => new Date(Date.UTC(y, m, d)).getUTCDay();
/** Does day `d` of month `m` (0-based) satisfy the rule's BYDAY, with ordinals counted from the month's start or end? */
function byDayOk(r: Rule, y: number, m: number, d: number) {
  const wd = weekday(y, m, d);
  const last = daysIn(y, m);
  return r.byDay.some(
    (x) =>
      x.wd === wd &&
      (x.n === 0 || (x.n > 0 ? Math.ceil(d / 7) === x.n : Math.ceil((last - d + 1) / 7) === -x.n)),
  );
}
function monthDays(r: Rule, y: number, m: number, startDay: number, defaultDay: boolean): number[] {
  const out: number[] = [];
  const last = daysIn(y, m);
  for (let d = 1; d <= last; d++) {
    const dayOk = r.byMonthDay.length
      ? r.byMonthDay.some((x) => (x > 0 ? x === d : last + x + 1 === d))
      : r.byDay.length || !defaultDay
        ? true
        : d === startDay;
    if (dayOk && (!r.byDay.length || byDayOk(r, y, m, d))) out.push(d);
  }
  return out;
}
const pickSet = (days: number[], pos: number[]) =>
  pos.length
    ? [...new Set(pos.map((p) => (p > 0 ? days[p - 1] : days[days.length + p])))]
        .filter((d): d is number => d !== undefined)
        .sort((a, b) => a - b)
    : days;

type Wall = { y: number; m: number; d: number };
/** The first instant (as a clock reading) of period number `k`. */
function periodStart(r: Rule, s: Wall, k: number) {
  if (r.freq === "DAILY") return Date.UTC(s.y, s.m, s.d + k * r.interval);
  if (r.freq === "WEEKLY") return Date.UTC(s.y, s.m, s.d - 7 + k * 7 * r.interval);
  if (r.freq === "MONTHLY") return Date.UTC(s.y, s.m + k * r.interval, 1);
  return Date.UTC(s.y + k * r.interval, 0, 1);
}
/** The days (wall dates) of period number `k` of the rule, in order. */
function periodDays(r: Rule, start: Wall, k: number): Wall[] {
  const monthOk = (m: number) => !r.byMonth.length || r.byMonth.includes(m + 1);
  if (r.freq === "DAILY") {
    const t = new Date(Date.UTC(start.y, start.m, start.d + k * r.interval));
    const w = { y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() };
    const ok =
      monthOk(w.m) &&
      (!r.byMonthDay.length ||
        r.byMonthDay.some((x) => (x > 0 ? x === w.d : daysIn(w.y, w.m) + x + 1 === w.d))) &&
      (!r.byDay.length || r.byDay.some((x) => x.wd === weekday(w.y, w.m, w.d)));
    return ok ? [w] : [];
  }
  if (r.freq === "WEEKLY") {
    const first = new Date(Date.UTC(start.y, start.m, start.d));
    const back = (first.getUTCDay() - r.wkst + 7) % 7;
    const weekStart = Date.UTC(start.y, start.m, start.d - back + k * 7 * r.interval);
    const wds = r.byDay.length ? r.byDay.map((x) => x.wd) : [first.getUTCDay()];
    const days: Wall[] = [];
    for (let i = 0; i < 7; i++) {
      const t = new Date(weekStart + i * DAY);
      if (wds.includes(t.getUTCDay()) && monthOk(t.getUTCMonth()))
        days.push({ y: t.getUTCFullYear(), m: t.getUTCMonth(), d: t.getUTCDate() });
    }
    return days;
  }
  if (r.freq === "MONTHLY") {
    const t = new Date(Date.UTC(start.y, start.m + k * r.interval, 1));
    const [y, m] = [t.getUTCFullYear(), t.getUTCMonth()];
    if (!monthOk(m)) return [];
    return pickSet(monthDays(r, y, m, start.d, true), r.bySetPos).map((d) => ({ y, m, d }));
  }
  const y = start.y + k * r.interval;
  const months = r.byMonth.length ? r.byMonth.map((x) => x - 1) : [start.m];
  return [...months]
    .sort((a, b) => a - b)
    .flatMap((m) =>
      pickSet(monthDays(r, y, m, start.d, !r.byMonthDay.length && !r.byDay.length), r.bySetPos).map(
        (d) => ({ y, m, d }),
      ),
    );
}

type Raw = {
  uid: string;
  title: string;
  location: string;
  description: string;
  status: string;
  start: Value;
  end: Value | undefined;
  duration: number | undefined;
  rule: Rule | undefined;
  exdates: Set<number>;
  rdates: Value[];
  recurrenceId: number | undefined;
};

function readEvent(props: Prop[], floating: string | undefined): Raw | undefined {
  const first = (n: string) => props.find((p) => p.name === n);
  const startProp = first("DTSTART");
  const start = startProp ? parseDate(startProp, floating) : undefined;
  if (!start) return undefined;
  const endProp = first("DTEND");
  const dur = first("DURATION");
  const rid = first("RECURRENCE-ID");
  const exdates = new Set<number>();
  const rdates: Value[] = [];
  for (const p of props) {
    if (p.name !== "EXDATE" && p.name !== "RDATE") continue;
    for (const v of p.value.split(",")) {
      const d = parseDate({ ...p, value: v }, floating);
      if (!d) continue;
      if (p.name === "EXDATE") exdates.add(d.ms);
      else rdates.push(d);
    }
  }
  const rr = first("RRULE");
  return {
    uid: first("UID")?.value.trim() || `${start.ms}`,
    title: unescapeText(first("SUMMARY")?.value ?? "").trim(),
    location: unescapeText(first("LOCATION")?.value ?? "").trim(),
    description: unescapeText(first("DESCRIPTION")?.value ?? "").trim(),
    status: (first("STATUS")?.value ?? "").trim().toUpperCase(),
    start,
    end: endProp ? parseDate(endProp, floating) : undefined,
    duration: dur ? parseDuration(dur.value) : undefined,
    rule: rr ? parseRule(rr.value, floating) : undefined,
    exdates,
    rdates,
    recurrenceId: rid ? parseDate(rid, floating)?.ms : undefined,
  };
}

/** The length of one occurrence in milliseconds. */
function lengthOf(e: Raw) {
  if (e.end) return Math.max(0, e.end.ms - e.start.ms);
  if (e.duration !== undefined) return Math.max(0, e.duration);
  return e.start.allDay ? DAY : 0;
}

/** Reads a feed and returns the events that overlap the window, soonest first. `cut` says the result was limited to `max`. */
export function parseIcs(text: string, win: IcsWindow, max = 500): IcsResult {
  const lines = text
    .replace(/^﻿/, "")
    .replace(/\r\n|\r/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
  let name = "";
  let floating: string | undefined;
  for (const l of lines) {
    const p = l.startsWith("X-WR-") ? parseLine(l) : undefined;
    if (p?.name === "X-WR-CALNAME" && !name) name = unescapeText(p.value).trim();
    if (p?.name === "X-WR-TIMEZONE" && !floating) floating = resolveZone(p.value.trim());
  }
  const raws: Raw[] = [];
  let cur: Prop[] | undefined;
  let skip = 0; // inside a nested component (VALARM)
  for (const l of lines) {
    if (!l) continue;
    const up = l.slice(0, 16).toUpperCase();
    if (up.startsWith("BEGIN:VEVENT")) {
      cur = [];
      skip = 0;
    } else if (up.startsWith("END:VEVENT")) {
      const e = cur && readEvent(cur, floating);
      if (e) raws.push(e);
      cur = undefined;
    } else if (cur) {
      if (up.startsWith("BEGIN:")) skip += 1;
      else if (up.startsWith("END:")) skip = Math.max(0, skip - 1);
      else if (!skip) {
        const p = parseLine(l);
        if (p) cur.push(p);
      }
    }
  }
  // Overrides of one occurrence, by the series and the occurrence's original start.
  const overrides = new Map<string, Raw>();
  for (const e of raws)
    if (e.recurrenceId !== undefined) overrides.set(`${e.uid}|${e.recurrenceId}`, e);

  const out: IcsEvent[] = [];
  const emit = (e: Raw, startMs: number, recurring: boolean, startVal: Value) => {
    if (e.status === "CANCELLED") return;
    const len = lengthOf(e);
    const endMs = startMs + len;
    if (
      startMs >= win.to.getTime() ||
      (len > 0 ? endMs <= win.from.getTime() : startMs < win.from.getTime())
    )
      return;
    out.push({
      uid: e.uid,
      title: e.title || "(no title)",
      start: new Date(startMs),
      end: len > 0 ? new Date(endMs) : null,
      allDay: startVal.allDay,
      location: e.location,
      description: e.description,
      recurring,
      timezone: startVal.tz ?? null,
    });
  };
  for (const e of raws) {
    if (e.recurrenceId !== undefined) {
      // A moved occurrence is shown when the series is shown; one whose series is not in the feed stands alone.
      if (!raws.some((x) => x.uid === e.uid && x.recurrenceId === undefined && x.rule))
        emit(e, e.start.ms, true, e.start);
      continue;
    }
    if (!e.rule && !e.rdates.length) {
      emit(e, e.start.ms, false, e.start);
      continue;
    }
    const starts: number[] = [];
    if (e.rule) {
      const r = e.rule;
      const wall = new Date(e.start.wall);
      const s: Wall = { y: wall.getUTCFullYear(), m: wall.getUTCMonth(), d: wall.getUTCDate() };
      const clock = e.start.wall - Date.UTC(s.y, s.m, s.d);
      let seen = 0;
      let scanned = 0;
      let done = false;
      for (let k = 0; !done && scanned < MAX_OCCURRENCES_SCANNED && k < 50_000; k++) {
        // Every day of a period is on or after the period's start, so a period that starts past the window ends the search.
        if (k > 0 && periodStart(r, s, k) > win.to.getTime() + DAY) break;
        const days = periodDays(r, s, k);
        for (const w of days) {
          const wallMs = Date.UTC(w.y, w.m, w.d) + clock;
          if (wallMs < e.start.wall) continue;
          scanned += 1;
          const ms = e.start.allDay ? wallMs : wallToInstant(wallMs, e.start.tz);
          if (r.until !== undefined && ms > r.until) {
            done = true;
            break;
          }
          seen += 1;
          if (r.count !== undefined && seen > r.count) {
            done = true;
            break;
          }
          if (ms >= win.to.getTime() + DAY) {
            done = true;
            break;
          }
          starts.push(ms);
        }
      }
      if (!starts.includes(e.start.ms)) starts.unshift(e.start.ms); // the first instance is always DTSTART
    } else starts.push(e.start.ms);
    for (const d of e.rdates) starts.push(d.ms);
    for (const ms of [...new Set(starts)].sort((a, b) => a - b)) {
      if (e.exdates.has(ms)) continue;
      const o = overrides.get(`${e.uid}|${ms}`);
      if (o) emit(o, o.start.ms, true, o.start);
      else emit(e, ms, true, e.start);
    }
  }
  out.sort((a, b) => a.start.getTime() - b.start.getTime() || a.title.localeCompare(b.title));
  return { name, events: out.slice(0, max), cut: out.length > max };
}
