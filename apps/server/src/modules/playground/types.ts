import type { PlaygroundFileSnapshot, PlaygroundLanguage } from "@zetta/db/schema/playground";

export class PlaygroundError extends Error {
  constructor(
    readonly code:
      | "NOT_FOUND"
      | "FORBIDDEN"
      | "CONFLICT"
      | "INVALID"
      | "SECRET_REJECTED"
      | "TOO_LARGE"
      | "BUSY"
      | "UNAVAILABLE",
    /** A sentence for the person, when the fixed text of the code is too vague (which file, which input). */
    readonly detail?: string,
  ) {
    super(code);
  }
}

/** What a runner gets: the files and inputs of one run, already checked by the service. */
export type RunSpec = {
  language: PlaygroundLanguage;
  entry: string;
  files: readonly PlaygroundFileSnapshot[];
  inputs: Record<string, unknown>;
  timeoutMs: number;
};
export type RunOutputFile = { path: string; content: Buffer; mimeType: string };
export type RunResult = {
  status: "ok" | "failed" | "timeout" | "cancelled";
  /** Null when a signal ended the process (timeout, cancel). */
  exitCode: number | null;
  stdout: string;
  stderr: string;
  /** The tail of a stream was cut, or `out/` files were dropped for size. */
  truncated: boolean;
  outputs: RunOutputFile[];
  runtimeVersion: string;
};
/** Runs one script to the end. Throws `PlaygroundError("UNAVAILABLE")` when it cannot start at all (no CLI, no engine). */
export type Runner = (spec: RunSpec, signal: AbortSignal) => Promise<RunResult>;

/** The HTTP status and the sentence for each error code. A `detail` on the error says more (which file, which input). */
export const PLAYGROUND_ERRORS: Record<PlaygroundError["code"], [number, string]> = {
  NOT_FOUND: [404, "No such playground."],
  FORBIDDEN: [403, "Only the owner can do this. Fork it to make your own copy."],
  CONFLICT: [409, "This changed. Reload and try again."],
  INVALID: [400, "Check the playground and try again."],
  SECRET_REJECTED: [
    400,
    "The playground looks like it holds a key or a token. Remove it and save again.",
  ],
  TOO_LARGE: [413, "The playground is too large."],
  BUSY: [429, "Too many runs are going. Try again when one ends."],
  UNAVAILABLE: [503, "This runner is not available on the server."],
};
