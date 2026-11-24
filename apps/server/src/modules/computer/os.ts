import { computerOsList } from "@zetta/db/schema/features";

export type OsId = (typeof computerOsList)[number];
export const OS_IDS = computerOsList;

type Entry = { id: string; family: "linux" | "windows" | "macos"; label: string };
/** What a person can run as a container computer. `browser`: the image has Chromium (Ubuntu ships it only as a snap, which does not run in a container). */
const RUNNABLE: (Entry & { id: OsId; browser: boolean })[] = [
  { id: "debian", family: "linux", label: "Debian 13", browser: true },
  { id: "ubuntu", family: "linux", label: "Ubuntu 24.04", browser: false },
];
/** Listed so people see the whole picture, but they cannot be created: a Linux container cannot run them. */
const NOT_RUNNABLE: (Entry & { note: string })[] = [
  {
    id: "windows",
    family: "windows",
    label: "Windows",
    note: "Needs a Windows virtual machine and a licence; container computers are Linux only.",
  },
  {
    id: "macos",
    family: "macos",
    label: "macOS",
    note: "Only as this server's own desktop (the local target), which is not available yet.",
  },
];

export const hasBrowser = (os: OsId) => RUNNABLE.find((o) => o.id === os)?.browser ?? false;

/** The list a person picks from: every system, with whether it can be created now and why not. */
export function osOptions(offered: readonly OsId[]) {
  return [
    ...RUNNABLE.map((o) => ({
      id: o.id,
      family: o.family,
      label: o.label,
      browser: o.browser,
      available: offered.includes(o.id),
      ...(offered.includes(o.id)
        ? {}
        : { note: "Not turned on for this server (Studio > Server settings)." }),
    })),
    ...NOT_RUNNABLE.map((o) => ({ ...o, browser: false, available: false })),
  ];
}
