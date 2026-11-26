import { describe, expect, test } from "bun:test";

import {
  ACCOUNT_ENGINES,
  defaultAccountLabel,
  ENGINE_SIGN_IN,
  KEY_ENV,
  LOGIN_FOLDER_ENV,
  signInMethod,
  TOKEN_ENV,
} from "./engine-accounts";

describe("agent accounts", () => {
  test("every engine has at least one way to connect an account, with ids that are unique", () => {
    for (const engine of ACCOUNT_ENGINES) {
      const methods = ENGINE_SIGN_IN[engine];
      expect([engine, methods.length > 0]).toEqual([engine, true]);
      expect(new Set(methods.map((m) => m.id)).size).toBe(methods.length);
      for (const method of methods) {
        expect(method.label.length).toBeGreaterThan(5);
        expect(method.help.length).toBeGreaterThan(20);
      }
    }
  });

  test("what a way leaves behind is something a run of that engine can use", () => {
    for (const engine of ACCOUNT_ENGINES)
      for (const method of ENGINE_SIGN_IN[engine]) {
        if (method.way === "guided" && method.result === "token")
          expect([engine, TOKEN_ENV[engine] !== undefined]).toEqual([engine, true]);
        if (method.way === "guided" && method.result === "login")
          expect([engine, LOGIN_FOLDER_ENV[engine] !== undefined]).toEqual([engine, true]);
        if (method.way === "paste" && method.kind === "token")
          expect([engine, TOKEN_ENV[engine] !== undefined]).toEqual([engine, true]);
        if (method.way === "paste" && method.kind === "api_key") {
          expect(method.providers?.length).toBeGreaterThan(0);
          for (const provider of method.providers ?? []) expect(KEY_ENV[provider]).toBeDefined();
        }
      }
  });

  test("the four engines people asked for each offer their subscription or their key", () => {
    expect(signInMethod("claude-code", "subscription")).toMatchObject({
      way: "guided",
      result: "token",
    });
    expect(signInMethod("codex", "subscription")).toMatchObject({ way: "guided", input: "none" });
    expect(signInMethod("omp", "subscription-anthropic")).toMatchObject({ provider: "anthropic" });
    // Pi signs in only inside its own full screen: it takes a key.
    expect(ENGINE_SIGN_IN.pi.every((m) => m.way === "paste")).toBe(true);
    expect(signInMethod("codex", "nothing")).toBeUndefined();
  });

  test("an account the person did not name says what it is", () => {
    expect(defaultAccountLabel("api_key", "openai")).toBe("OpenAI key");
    expect(defaultAccountLabel("api_key", "other")).toBe("API key");
    expect(defaultAccountLabel("token")).toBe("Subscription");
    expect(defaultAccountLabel("login")).toBe("Subscription");
  });
});
