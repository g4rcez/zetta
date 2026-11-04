import { computerDrivers } from "@zetta/db/schema/features";
import type { CredentialField } from "../../integrations/plugins/registry";

export type VmAction =
  | { type: "click"; x: number; y: number }
  | { type: "type"; text: string }
  | { type: "key"; key: string }
  | { type: "scroll"; direction: "up" | "down" | "left" | "right"; amount?: number }
  | { type: "launch"; app: string }
  | { type: "navigate"; url: string }
  /** Element [n] of the last read, clicked at the center of its frame. */
  | { type: "click_element"; n: number };

export const DRIVERS = computerDrivers;
export type DriverName = (typeof DRIVERS)[number];

/** An error from outside the driver (e.g. a credential grant refusing) that the service's `guard` must rethrow as is. */
export class Passthrough {
  constructor(readonly error: unknown) {}
}

/**
 * What the VM service needs from a desktop automation tool. A driver owns its tool names, output parsing and per-session state (window
 * cache, element labels); it never decides who may act, which address is allowed, or how long a session lives. It throws ComputerError
 * for a refused or failed step and lets a transport failure escape, which the service turns into DISCONNECTED.
 * Callers have already checked the address of `navigate` and the name of `launch`.
 */
export type DesktopDriver = {
  /** Waits (bounded) until the desktop has its browser window, then brings it to the front, so the first input has a target. */
  ready(): Promise<void>;
  /** True when the driver answers: a reattach to a running desktop uses it before trusting the session. */
  probe(): Promise<boolean>;
  act(action: VmAction, o?: { signal?: AbortSignal }): Promise<void>;
  /** The whole screen as a base64 PNG. */
  screenshot(): Promise<string>;
  /** The browser window as numbered text; `plain` when no browser window is open (what is open instead). */
  read(o: {
    settle?: boolean;
    signal?: AbortSignal;
  }): Promise<
    { kind: "page"; title: string | undefined; body: string } | { kind: "plain"; text: string }
  >;
  /** Types one credential into the sign-in input of the browser. `reveal(url)` checks the grant and the origin and returns the value. */
  fillCredential(
    field: CredentialField,
    reveal: (url: string) => Promise<string>,
  ): Promise<{ label: string }>;
};
