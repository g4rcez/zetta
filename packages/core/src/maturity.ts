/**
 * How far each area of Zetta has been proved. "stable" ran for real (a real browser, a real model or a real vendor, as the area needs);
 * "beta" is built and tested with fakes only; "experimental" has not been tried with the real thing at all.
 *
 * This is an internal checklist of what still needs a real run or a test. The web app does not show it as a label (no "Beta" or
 * "Experimental" marks): every feature is presented as working, so an area listed here as not stable gets a test or a real run, not a badge.
 * When a scripted end-to-end run (`scripts/e2e`, results in `.e2e-reports/`) comes back green for an area, move it to "stable" here in the same change.
 *
 * Only erasable syntax here (no enums, no namespaces): the web app, the server and the tests all import this file.
 */

export const MATURITY_LEVELS = ["stable", "beta", "experimental"] as const;
export type MaturityLevel = (typeof MATURITY_LEVELS)[number];

export type Maturity = {
  readonly level: MaturityLevel;
  /** One sentence for the person: what has not been proved yet. Empty only for "stable". */
  readonly reason: string;
};

export const MATURITY = {
  apps: {
    level: "beta",
    reason:
      "The page runs correctly in a real browser (checked 2026-11-15); app tools in the container runner were not run.",
  },
  playground: {
    level: "stable",
    reason: "",
  },
  projects: {
    level: "beta",
    reason:
      "The page and the brief draft ran for real (2026-11-15); the stalled-work scan never ran over days on the server's own timer.",
  },
  skills: {
    level: "beta",
    reason:
      "Browsing and previewing ran against the real GitHub (2026-11-15); installing and updating were tested with a fake one.",
  },
  memory_learning: {
    level: "stable",
    reason: "",
  },
  bot_quality: {
    level: "beta",
    reason:
      "Ratings, history, saved tests and the numbers ran in a real browser (2026-11-15); a saved test was never run with a real model.",
  },
  conversation_memory: {
    level: "beta",
    reason:
      "The summary ran with a real model (2026-11-15); the whole path of a long chat answered by a real bot was not run.",
  },
  workflow_steps: {
    level: "beta",
    reason:
      "Waiting, approval, loops and tool steps ran on a real database and on the canvas; a workflow with a real plugin or a real bot's answer was not run.",
  },
  documents: {
    level: "beta",
    reason:
      "Read from files built by the tests; real PDFs and Office files from other programs were not tried.",
  },
  voice: {
    level: "beta",
    reason:
      "A real speech model read spoken clips (2026-11-15); Portuguese came back about half right, a provider such as OpenAI was tested with a local fake only, and voice notes from a real phone were not tried.",
  },
  channel_slack: {
    level: "experimental",
    reason:
      "Tested with signed fake requests and a fake Slack; never connected to a real workspace.",
  },
  channel_mail: {
    level: "experimental",
    reason: "Tested with a fake mailbox; never connected to a real IMAP or SMTP server.",
  },
  computer_local: {
    level: "experimental",
    reason: "Controlling the server's own desktop is not available yet.",
  },
  desktop_app: {
    level: "experimental",
    reason: "The desktop app was only run on macOS; Windows and Linux builds were never launched.",
  },
} as const satisfies Record<string, Maturity>;

export type MaturityArea = keyof typeof MATURITY;

/** Engines (harnesses). Only the ones that ran for real in Zetta are stable. */
export const ENGINE_MATURITY = {
  "claude-code": { level: "stable", reason: "" },
  decision: { level: "stable", reason: "" },
  fixture: { level: "stable", reason: "" },
  codex: {
    level: "experimental",
    reason: "Not verified in Zetta yet: its CLI could not answer on the test machine.",
  },
  pi: {
    level: "experimental",
    reason: "Not verified in Zetta yet: its CLI could not answer on the test machine.",
  },
  omp: {
    level: "beta",
    reason: "Answered one real turn (2026-11-15); tools, streaming and isolation are not verified.",
  },
  opencode: { level: "experimental", reason: "A smoke test passed; the rest is not verified." },
  cursor: { level: "experimental", reason: "Not verified in Zetta yet." },
  hermes: {
    level: "beta",
    reason: "Answered one real turn (2026-11-15); tools, streaming and isolation are not verified.",
  },
  deepseek: { level: "experimental", reason: "Not verified in Zetta yet." },
} as const satisfies Record<string, Maturity>;

export type EngineId = keyof typeof ENGINE_MATURITY;

/** The engines a person should be warned about, in the order the new-bot page lists them. */
export const UNVERIFIED_ENGINES = (Object.keys(ENGINE_MATURITY) as EngineId[]).filter(
  (id) => ENGINE_MATURITY[id].level !== "stable",
);

export const maturityOf = (area: MaturityArea): Maturity => MATURITY[area];
export const engineMaturity = (id: string): Maturity =>
  (ENGINE_MATURITY as Record<string, Maturity>)[id] ?? {
    level: "experimental",
    reason: "Not verified in Zetta yet.",
  };
