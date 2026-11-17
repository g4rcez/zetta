// Fakes for tests of the wave 2 features (speech out, push, a model on the person's own server). No test of the foundation needs a
// database for them: the settings are a plain object and the keys are bytes in a map.
import { DEFAULT_SPEECH_SETTINGS } from "@zetta/core/speech";
import type { InstallationKeyReader, InstallationKeyState } from "../connections/installation-key";
import type { InstallationSettings } from "./service";

/** The installation settings with their defaults; pass what the test needs to differ. */
export const fakeInstallationSettings = (
  overrides: Partial<InstallationSettings> = {},
): InstallationSettings => ({
  networkMode: "local",
  publicUrl: null,
  onboarding: "done",
  laya: "off",
  layaLanguages: ["en"],
  transcribeProvider: "local",
  transcribeModel: "",
  transcribeLanguage: "",
  transcribeBaseUrl: "",
  transcribeConnectionId: null,
  ...DEFAULT_SPEECH_SETTINGS,
  speechConnectionId: null,
  pushPublicKey: null,
  pushConnectionId: null,
  updateCheck: "off",
  ...overrides,
});

/**
 * An `InstallationKeyReader` over a map: connection id -> key text. An id that is in `unreadable` reads as a saved key that cannot be
 * opened (its owner left). `operator` is the operator's own key, used when no id is recorded. Every `secret` call returns a new buffer,
 * as the real one does, so a caller that zeroes it cannot damage the next read.
 */
export function fakeInstallationKeys(
  o: { keys?: Record<string, string>; unreadable?: string[]; operator?: string } = {},
): InstallationKeyReader & { reads: number } {
  const keys = new Map(Object.entries(o.keys ?? {}));
  const unreadable = new Set(o.unreadable ?? []);
  const fake = {
    reads: 0,
    async state(id: string | null): Promise<InstallationKeyState> {
      if (!id) return o.operator ? "operator" : "none";
      return keys.has(id) && !unreadable.has(id) ? "set" : "unavailable";
    },
    async secret(id: string | null) {
      fake.reads += 1;
      if (!id) return o.operator ? Buffer.from(o.operator) : undefined;
      const key = keys.get(id);
      return key && !unreadable.has(id) ? Buffer.from(key) : undefined;
    },
  };
  return fake;
}
