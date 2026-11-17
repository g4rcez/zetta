/**
 * The lines a person writes about themselves (job title, department, about, time zone, contact). One place for the limits, so the
 * database checks, the server, the Chief's tool and the web form agree. Only erasable syntax: the web app imports this file too.
 */

/** Longest value of each line. They match the `user_preference` checks in the database. */
export const PROFILE_LIMITS = {
  jobTitle: 80,
  department: 80,
  about: 1000,
  timezone: 64,
  contact: 200,
} as const;

/** The text fields of a profile, in the order the form shows them. */
export const PROFILE_TEXT_FIELDS = ["jobTitle", "department", "about", "contact"] as const;
export type ProfileTextField = (typeof PROFILE_TEXT_FIELDS)[number];

/** What a person writes about themselves. Empty text means "not written". */
export type ProfileLines = {
  jobTitle: string;
  department: string;
  about: string;
  /** An IANA name ("America/Sao_Paulo"). Empty means the browser's. */
  timezone: string;
  contact: string;
};

const ZONE_SHAPE = /^[A-Za-z][A-Za-z0-9_+-]*(\/[A-Za-z0-9_+-]+){0,2}$/;

/** True for a real IANA time zone name. Offsets ("+02:00") and made-up names are not. */
export function isTimeZone(value: string): boolean {
  if (!value || value.length > PROFILE_LIMITS.timezone || !ZONE_SHAPE.test(value)) return false;
  try {
    new Intl.DateTimeFormat("en", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** The time zone of the device that runs this code, or "UTC" when it cannot say. */
export function browserTimeZone(): string {
  try {
    const zone = new Intl.DateTimeFormat().resolvedOptions().timeZone;
    return zone && isTimeZone(zone) ? zone : "UTC";
  } catch {
    return "UTC";
  }
}

const HTML_TAG = /<\/?[a-z!][^>]*>/i;
const CONTROL = /[\p{Cc}]/u;

/** Why a line is refused, or undefined when it is fine. `multiline` lets line breaks through (the "about" text). */
export function profileTextProblem(value: string, multiline = false): string | undefined {
  if (HTML_TAG.test(value)) return "Write plain text, without HTML tags.";
  const checked = multiline ? value.replace(/[\n\r\t]/g, " ") : value;
  if (CONTROL.test(checked)) return "Remove the control characters.";
  return undefined;
}

/**
 * A person's title for a list: what they wrote, else the title of the company-chart seat they hold, else nothing. Both are text a
 * person wrote, so callers that put it in a prompt must frame it as data.
 */
export const personTitle = (jobTitle: string | null | undefined, seatTitle?: string | null) =>
  (jobTitle ?? "").trim() || (seatTitle ?? "").trim();
