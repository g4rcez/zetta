// The private-network policy: may the server call addresses on this computer or on the network around it (private, loopback, link-local)?
// It is the setting `allowPrivateNetwork`. It is security policy, so every check asks at the moment of the call, never at start-up, and a
// check that cannot read the setting refuses (fail closed).
import type { SettingsService } from "./service";

/**
 * What a module accepts as its `allowPrivate` option: a fixed answer (tests, tools) or a function asked at every check. A missing option
 * means no.
 */
export type PrivateNetwork = boolean | (() => boolean | Promise<boolean>);

/** The answer now. A function that throws or answers anything but `true` is a no. */
export async function privateAllowed(policy: PrivateNetwork | undefined): Promise<boolean> {
  if (typeof policy === "boolean") return policy;
  if (!policy) return false;
  try {
    return (await policy()) === true;
  } catch {
    return false;
  }
}

/** Same as `privateAllowed` for a module whose check cannot wait: only a fixed answer, or a function that answers at once. */
export function privateAllowedNow(policy: PrivateNetwork | undefined): boolean {
  if (typeof policy === "boolean") return policy;
  if (!policy) return false;
  try {
    const answer = policy();
    return answer === true;
  } catch {
    return false;
  }
}

/**
 * The policy built once from the settings service. `allowed` reads the stored value on every call (cached for a few seconds by the
 * service) and refuses when it cannot be read. `current` is the same answer without waiting, from what this process last read: it is for
 * a check that cannot become async (see `SettingsService.peek`); a value never read, or one that is too old to trust, is a no.
 */
export function createPrivateNetworkPolicy(settings: Pick<SettingsService, "get" | "peek">) {
  return {
    allowed: async (): Promise<boolean> => {
      try {
        return (await settings.get("allowPrivateNetwork")) === "on";
      } catch {
        return false;
      }
    },
    current: (): boolean => settings.peek("allowPrivateNetwork") === "on",
  };
}
export type PrivateNetworkPolicy = ReturnType<typeof createPrivateNetworkPolicy>;
