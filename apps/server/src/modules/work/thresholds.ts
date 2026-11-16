import type { ProjectWatch } from "@zetta/db/schema/projects";

/**
 * When the work scan speaks up. Bots work around the clock, so their waits are plain hours. People's waits are working time: Saturday and
 * Sunday do not count (core/working-days.ts). A project's "how closely to watch" scales every wait.
 */
const HOUR = 60 * 60_000;
export const WORKING_DAY_MS = 24 * HOUR;

/** A bot task in progress that nobody calls the bot back for, with no change for this long. */
export const BOT_IDLE_MS = 2 * HOUR;
/** A person was asked for something and has not touched it for this long (working time): the manager hears. */
export const PERSON_UNANSWERED_MS = WORKING_DAY_MS;
/** A person's task in progress with no change for this long (working time): the person is asked, not the manager. */
export const PERSON_IDLE_MS = 2 * WORKING_DAY_MS;
/** How long the person has to answer "still working on this?" (working time) before the manager hears. */
export const CHECKIN_WAIT_MS = WORKING_DAY_MS;
/** "Give it more time": the card stays away this long (working time), unless the task changes first. */
export const MORE_TIME_MS = WORKING_DAY_MS;
/** "It's fine as it is": nobody asks about the direction of the task again for this long, unless it changes. */
export const ACCEPTED_MS = 30 * 24 * HOUR;
/** How often the scan looks. Nothing it reports is urgent to the minute. */
export const SCAN_EVERY_MS = 5 * 60_000;
/** Tasks looked at in one pass of each check. */
export const SCAN_LIMIT = 200;

const FACTOR: Record<ProjectWatch, number> = { close: 0.5, normal: 1, light: 2 };
/** A task outside every project is watched normally. */
export const watchFactor = (watch: ProjectWatch | null | undefined) => FACTOR[watch ?? "normal"];
/** "Lightly": nobody is checked on. The manager hears only when someone is blocked, asks, or a bot stops. */
export const checksOnPeople = (watch: ProjectWatch | null | undefined) => watch !== "light";
