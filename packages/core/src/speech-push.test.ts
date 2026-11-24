import { describe, expect, test } from "bun:test";
import {
  checkPushSubscription,
  DEFAULT_PUSH_MODE,
  isVapidPublicKey,
  PUSH_LIMITS,
  PUSH_MODES,
  pushAllows,
} from "./push";
import {
  DEFAULT_SPEECH_PROVIDER,
  DEFAULT_SPEECH_SETTINGS,
  normalizeSpeechSettings,
  SPEECH_PROVIDERS,
  speechIsLocal,
  speechIsRemote,
  speechSettingsIssue,
} from "./speech";

describe("speech settings", () => {
  test("the default needs no setup and the list is in the contract order", () => {
    expect(SPEECH_PROVIDERS).toEqual([
      "off",
      "browser",
      "local",
      "openai",
      "compatible",
      "elevenlabs",
    ]);
    expect(DEFAULT_SPEECH_PROVIDER).toBe("browser");
    expect(DEFAULT_SPEECH_SETTINGS.speechProvider).toBe("browser");
    expect(speechSettingsIssue(DEFAULT_SPEECH_SETTINGS)).toBeNull();
  });
  test("only the providers that call a server are remote", () => {
    expect(SPEECH_PROVIDERS.filter(speechIsRemote)).toEqual(["openai", "compatible", "elevenlabs"]);
  });
  test("local runs inside the server: no key, no address, not remote", () => {
    const local = { ...DEFAULT_SPEECH_SETTINGS, speechProvider: "local" as const };
    expect(speechIsLocal("local")).toBe(true);
    expect(SPEECH_PROVIDERS.filter(speechIsLocal)).toEqual(["local"]);
    expect(speechIsRemote("local")).toBe(false);
    expect(speechSettingsIssue(local)).toBeNull();
    expect(
      normalizeSpeechSettings({ ...local, speechBaseUrl: "https://tts.example.invalid/v1" })
        .speechBaseUrl,
    ).toBe("");
  });
  test("compatible needs its address; the other providers drop one", () => {
    const base = { ...DEFAULT_SPEECH_SETTINGS, speechProvider: "compatible" as const };
    expect(speechSettingsIssue(base)).toMatch(/address/);
    expect(
      speechSettingsIssue({ ...base, speechBaseUrl: "https://tts.example.invalid/v1" }),
    ).toBeNull();
    expect(
      normalizeSpeechSettings({
        ...base,
        speechProvider: "openai",
        speechBaseUrl: "https://tts.example.invalid/v1",
      }).speechBaseUrl,
    ).toBe("");
  });
  test("names and lengths are limited", () => {
    expect(speechSettingsIssue({ ...DEFAULT_SPEECH_SETTINGS, speechModel: "tts-1-hd" })).toBeNull();
    expect(speechSettingsIssue({ ...DEFAULT_SPEECH_SETTINGS, speechVoice: "a b" })).toMatch(
      /voice/,
    );
    expect(
      speechSettingsIssue({ ...DEFAULT_SPEECH_SETTINGS, speechModel: "x".repeat(101) }),
    ).toMatch(/model/);
    expect(
      speechSettingsIssue({ ...DEFAULT_SPEECH_SETTINGS, speechLanguage: "x".repeat(36) }),
    ).toMatch(/language/);
    expect(
      speechSettingsIssue({ ...DEFAULT_SPEECH_SETTINGS, speechProvider: "nope" as never }),
    ).toMatch(/provider/);
  });
});

describe("push", () => {
  test("modes and the default", () => {
    expect(PUSH_MODES).toEqual(["all", "mentions_and_approvals", "off"]);
    expect(DEFAULT_PUSH_MODE).toBe("mentions_and_approvals");
  });
  test("a public VAPID key is 87 base64url characters", () => {
    expect(isVapidPublicKey("B".repeat(87))).toBe(true);
    expect(isVapidPublicKey("B".repeat(86))).toBe(false);
    expect(isVapidPublicKey("+".repeat(87))).toBe(false);
  });
  test("what each mode lets through", () => {
    expect(pushAllows("all", "other")).toBe(true);
    expect(pushAllows("mentions_and_approvals", "mention")).toBe(true);
    expect(pushAllows("mentions_and_approvals", "approval")).toBe(true);
    expect(pushAllows("mentions_and_approvals", "other")).toBe(false);
    expect(pushAllows("off", "mention")).toBe(false);
    expect(pushAllows("off", "approval")).toBe(false);
  });

  const good = {
    endpoint: "https://push.example.invalid/send/abc123",
    p256dh:
      "BNcRdreALRFXTkOOUHK1EtK2wtaz5Ry4YfYCA_0QTpQtUbVlUls0VJXg7A8u-Ts1XbjhazAkj7I99e8QcYP7DkM",
    auth: "tBHItJI5svbpez7KI4CCXg",
  };
  test("a real-looking subscription passes and the user agent is cut", () => {
    const r = checkPushSubscription({ ...good, userAgent: "u".repeat(500) });
    expect(r.ok).toBe(true);
    if (r.ok) expect(r.value.userAgent).toHaveLength(PUSH_LIMITS.userAgent);
    const none = checkPushSubscription(good);
    expect(none.ok && none.value.userAgent).toBe("");
  });
  test("the endpoint must be an https push service name", () => {
    const issue = (endpoint: string) => {
      const r = checkPushSubscription({ ...good, endpoint });
      return r.ok ? null : r.issue;
    };
    expect(issue("http://push.example.invalid/x")).toBe("endpoint_not_https");
    expect(issue("https://127.0.0.1/x")).toBe("endpoint_forbidden_host");
    expect(issue("https://169.254.169.254/x")).toBe("endpoint_forbidden_host");
    expect(issue("https://[::1]/x")).toBe("endpoint_forbidden_host");
    expect(issue("https://localhost/x")).toBe("endpoint_forbidden_host");
    expect(issue("https://intranet/x")).toBe("endpoint_forbidden_host");
    expect(issue("https://box.local/x")).toBe("endpoint_forbidden_host");
    expect(issue("https://user:pw@push.example.invalid/x")).toBe("endpoint_forbidden_host");
    expect(issue("javascript:alert(1)")).toBe("endpoint_not_https");
    expect(issue("nonsense")).toBe("endpoint_invalid");
    expect(issue(`https://push.example.invalid/${"a".repeat(PUSH_LIMITS.endpoint)}`)).toBe(
      "endpoint_too_long",
    );
  });
  test("the keys are base64url and within their limits", () => {
    for (const bad of [
      { ...good, p256dh: "" },
      { ...good, auth: "a b" },
      { ...good, auth: "x".repeat(PUSH_LIMITS.auth + 1) },
      { ...good, p256dh: "x".repeat(PUSH_LIMITS.p256dh + 1) },
      { ...good, p256dh: "+/ab" },
    ]) {
      const r = checkPushSubscription(bad);
      expect(r.ok ? null : r.issue).toBe("key_invalid");
    }
  });
});
