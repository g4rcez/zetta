import { describe, expect, test } from "bun:test";
import { signInMethod } from "@zetta/core/engine-accounts";

import { accountFolder, attach, guidedRun, loginCheck } from "./adapters";
import { plain } from "./sign-in";

const guided = (engine: Parameters<typeof guidedRun>[0], id: string) => {
  const method = signInMethod(engine, id);
  if (method?.way !== "guided") throw new Error("not guided");
  return guidedRun(engine, method);
};
const account = (over: Partial<Parameters<typeof attach>[0]>) => ({
  id: "0192f3a0-0000-7000-8000-0000000000aa",
  ownerUserId: "ana",
  engine: "claude-code" as const,
  kind: "token" as const,
  provider: null,
  ...over,
});

describe("what a sign-in command prints", () => {
  // The texts are what each CLI printed on 2026-11-26 (claude 2.1.332, codex 0.163.0, omp 18.6.1), with the secrets replaced.
  test("Claude Code in a terminal: the link, then the token", () => {
    const run = guided("claude-code", "subscription");
    expect(run.terminal).toBe(true);
    const screen =
      "Thiswillguideyouthroughlong-lived(1-year)authtokensetup · Browser didn't open?Use the URLbelowtosignin(c to copy) https://claude.ai/oauth/authorize?ID8tEL9FKiexW4GuXdVC1jm Pastecodehereifprompted ╭────";
    expect(run.read(screen)).toEqual({
      url: "https://claude.ai/oauth/authorize?ID8tEL9FKiexW4GuXdVC1jm",
      token: undefined,
    });
    const token = `sk-ant-oat01-${"a1B2_c3-".repeat(6)}`;
    expect(
      run.read(`${screen} Your OAuth token (valid for 1 year): ${token} Store this`).token,
    ).toBe(token);
    expect(run.env("/acc")).toEqual({ CLAUDE_CONFIG_DIR: "/acc" });
  });

  test("Codex: a link and a one-time code, and nothing to type", () => {
    const run = guided("codex", "subscription");
    expect(run.terminal).toBe(false);
    const text = plain(
      "Welcome to Codex [v\x1b[90m0.163.0\x1b[0m]\n1. Open this link in your browser and sign in to your account\n   \x1b[94mhttps://auth.openai.com/codex/device\x1b[0m\n\n2. Enter this one-time code \x1b[90m(expires in 15 minutes)\x1b[0m\n   \x1b[94mAB12-CD345\x1b[0m\n",
    );
    expect(run.read(text)).toEqual({
      url: "https://auth.openai.com/codex/device",
      code: "AB12-CD345",
    });
    expect(run.env("/acc")).toEqual({ CODEX_HOME: "/acc" });
  });

  test("OMP: the link after its own line, for the provider asked", () => {
    const run = guided("omp", "subscription-openai");
    expect(run.argv).toEqual(["omp", "login", "openai-codex"]);
    const text =
      "See https://example.invalid/docs first.\nOpen this URL in your browser:\nhttps://claude.ai/oauth/authorize?client_id=x&state=y\nLocal shortcut (this machine only): http://localhost:54545/launch\n";
    expect(run.read(text).url).toBe("https://claude.ai/oauth/authorize?client_id=x&state=y");
    expect(run.env("/acc")).toEqual({ PI_CODING_AGENT_DIR: "/acc" });
  });

  test("a terminal's own marks are taken off, and a link inside a hyperlink wrapper is kept", () => {
    expect(plain("\x1b[1mBold\x1b[0m \x1b[2K\x1b[10;4Hmoved")).toBe(" Bold    moved");
    expect(
      plain(
        "visit:\n\x1b]8;;https://claude.ai/oauth/authorize?abc\x07link text\x1b]8;;\x07 done",
      ).replace(/\s+/g, " "),
    ).toBe("visit: https://claude.ai/oauth/authorize?abc link text done");
  });
});

describe("whether a sign-in still holds", () => {
  test("Codex and OMP answer; Claude Code has a token and Pi a key, so nothing is asked", () => {
    const codex = loginCheck("codex", null)!;
    expect(codex.signedIn("Logged in using ChatGPT", 0)).toBe(true);
    expect(codex.signedIn("Not logged in", 0)).toBe(false);
    expect(codex.signedIn("Logged in using ChatGPT", 1)).toBe(false);
    const omp = loginCheck("omp", "anthropic")!;
    expect(omp.argv).toEqual(["omp", "token", "anthropic", "--list"]);
    expect(omp.signedIn('No OAuth accounts found for provider "anthropic".', 0)).toBe(false);
    expect(omp.signedIn("1  ana@example.invalid", 0)).toBe(true);
    expect(loginCheck("claude-code", null)).toBeUndefined();
    expect(loginCheck("pi", null)).toBeUndefined();
  });
});

describe("what a run gets from an account", () => {
  test("a subscription token travels in the engine's own variable, with no folder", () => {
    expect(attach(account({}), "sk-ant-oat01-x")).toEqual({
      accountId: account({}).id,
      ownerUserId: "ana",
      env: { CLAUDE_CODE_OAUTH_TOKEN: "sk-ant-oat01-x" },
    });
  });

  test("a key travels in its provider's variable", () => {
    expect(attach(account({ kind: "api_key", provider: "anthropic" }), "sk-ant-api").env).toEqual({
      ANTHROPIC_API_KEY: "sk-ant-api",
    });
    expect(
      attach(account({ engine: "pi", kind: "api_key", provider: "google" }), "g-key").env,
    ).toEqual({
      GEMINI_API_KEY: "g-key",
    });
  });

  test("a CLI that keeps a sign-in in a folder is pointed at the account's own, also for a key", () => {
    const key = attach(
      account({ engine: "codex", kind: "api_key", provider: "openai" }),
      "sk-openai",
    );
    expect(key.env).toEqual({ OPENAI_API_KEY: "sk-openai", CODEX_API_KEY: "sk-openai" });
    expect(key.folder).toEqual({ path: accountFolder(account({}).id), variable: "CODEX_HOME" });
    const login = attach(account({ engine: "codex", kind: "login" }), undefined);
    expect(login.env).toEqual({});
    expect(login.folder?.variable).toBe("CODEX_HOME");
    expect(
      attach(account({ engine: "omp", kind: "login", provider: "anthropic" }), undefined).folder
        ?.variable,
    ).toBe("PI_CODING_AGENT_DIR");
  });

  test("an account that cannot be used gives nothing, never half of a run", () => {
    expect(() => attach(account({}), undefined)).toThrow();
    expect(() => attach(account({ engine: "codex" }), "token")).toThrow();
    expect(() => attach(account({ kind: "api_key", provider: "nobody" }), "key")).toThrow();
    expect(() => attach(account({ kind: "api_key", provider: "anthropic" }), undefined)).toThrow();
  });

  test("an account's folder is named after it, inside the server's data folder", () => {
    expect(accountFolder("abc")).toEndWith("/engine-accounts/abc");
  });
});
