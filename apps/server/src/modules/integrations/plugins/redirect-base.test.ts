// One public base for every OAuth callback: `ZETTA_OAUTH_REDIRECT_BASE`, else the server address. The per-provider copies that existed
// (a Google, a Reddit and a Composio variable) are gone and have no effect.
import { afterEach, beforeEach, describe, expect, test } from "bun:test";
import { redirectUri as composioUri, settings as composio } from "./composio/api";
import { redirectUri as googleUri, settings as google } from "./google/oauth";
import { redirectBase, redirectUri as sharedUri } from "./oauth2";
import { redirectUri as redditUri, settings as reddit } from "./reddit/oauth";

const NAMES = [
  "ZETTA_OAUTH_REDIRECT_BASE",
  "ZETTA_SERVER_URL",
  "GOOGLE_OAUTH_REDIRECT_BASE",
  "REDDIT_OAUTH_REDIRECT_BASE",
  "COMPOSIO_REDIRECT_BASE",
] as const;
const saved: Record<string, string | undefined> = {};
beforeEach(() => {
  for (const n of NAMES) {
    saved[n] = process.env[n];
    delete process.env[n];
  }
});
afterEach(() => {
  for (const n of NAMES)
    if (saved[n] === undefined) delete process.env[n];
    else process.env[n] = saved[n];
});

const all = () => [
  googleUri(google()),
  redditUri(reddit()),
  composioUri(composio()),
  sharedUri({ id: "canva" } as never),
];

describe("the OAuth redirect base", () => {
  test("ZETTA_OAUTH_REDIRECT_BASE is the base of every provider, the trailing slash dropped", () => {
    process.env.ZETTA_OAUTH_REDIRECT_BASE = "https://public.example.invalid/";
    process.env.ZETTA_SERVER_URL = "https://server.example.invalid";
    expect(all()).toEqual([
      "https://public.example.invalid/api/plugins/google/callback",
      "https://public.example.invalid/api/plugins/reddit/callback",
      "https://public.example.invalid/api/plugins/composio/callback",
      "https://public.example.invalid/api/plugins/canva/callback",
    ]);
  });

  test("without it the server address is used", () => {
    process.env.ZETTA_SERVER_URL = "https://server.example.invalid";
    expect(redirectBase()).toBe("https://server.example.invalid");
    expect(all().every((u) => u.startsWith("https://server.example.invalid/api/plugins/"))).toBe(
      true,
    );
  });

  test("the removed per-provider variables have no effect, alone or against the shared one", () => {
    process.env.GOOGLE_OAUTH_REDIRECT_BASE = "https://copy.example.invalid";
    process.env.REDDIT_OAUTH_REDIRECT_BASE = "https://copy.example.invalid";
    process.env.COMPOSIO_REDIRECT_BASE = "https://copy.example.invalid";
    // Alone: no base at all (the settings say so, and the web client of Google asks for one).
    expect(google().redirectBase).toBeUndefined();
    expect(reddit().redirectBase).toBeUndefined();
    expect(composio().redirectBase).toBeUndefined();
    process.env.ZETTA_OAUTH_REDIRECT_BASE = "https://public.example.invalid";
    expect(all().some((u) => u.includes("copy.example.invalid"))).toBe(false);
    expect(google().redirectBase).toBe("https://public.example.invalid");
  });
});
