import { describe, expect, test } from "bun:test";
import { fieldFits, originAllowed, originPattern, pickInput, type AxElement } from "./credentials";

const input = (
  o: Partial<{ type: string; autocomplete: string; name: string; inputmode: string }>,
) => ({ tag: "input", type: "text", autocomplete: "", name: "", inputmode: "", ...o });

describe("credential origins", () => {
  test("patterns are normalized hosts; IPs, localhost and junk are refused", () => {
    expect(originPattern("https://GitHub.com/login?x=1")).toBe("github.com");
    expect(originPattern("*.Example.com")).toBe("*.example.com");
    expect(originPattern("accounts.google.com:443")).toBe("accounts.google.com");
    for (const bad of ["", "localhost", "127.0.0.1", "javascript:alert(1)", "*.com", "a b.com"])
      expect(originPattern(bad)).toBeUndefined();
  });
  test("only https pages on an exact host or a wildcard's subdomains match", () => {
    expect(originAllowed("https://github.com/login", ["github.com"])).toBe(true);
    expect(originAllowed("http://github.com/login", ["github.com"])).toBe(false);
    expect(originAllowed("https://github.com.evil.io/login", ["github.com"])).toBe(false);
    expect(originAllowed("https://evilgithub.com/", ["github.com"])).toBe(false);
    expect(originAllowed("https://gist.github.com/", ["github.com"])).toBe(false);
    expect(originAllowed("https://gist.github.com/", ["*.github.com"])).toBe(true);
    expect(originAllowed("https://github.com/", ["*.github.com"])).toBe(true);
    expect(originAllowed("https://user:pw@github.com/", ["github.com"])).toBe(false);
    expect(originAllowed("not a url", ["github.com"])).toBe(false);
  });
});

describe("focused input checks", () => {
  test("a password only goes into a password input", () => {
    expect(fieldFits("password", input({ type: "password" }))).toBe(true);
    expect(fieldFits("password", input({ name: "password comment" }))).toBe(false);
    expect(fieldFits("password", { ...input({ type: "" }), tag: "textarea" })).toBe(false);
    expect(fieldFits("password", null)).toBe(false);
  });
  test("usernames and codes need a matching hint", () => {
    expect(fieldFits("username", input({ autocomplete: "username" }))).toBe(true);
    expect(fieldFits("username", input({ type: "email" }))).toBe(true);
    expect(fieldFits("username", input({ name: "search" }))).toBe(false);
    expect(fieldFits("username", input({ type: "password", name: "login" }))).toBe(false);
    expect(fieldFits("totp", input({ autocomplete: "one-time-code" }))).toBe(true);
    expect(fieldFits("totp", input({ inputmode: "numeric" }))).toBe(true);
    expect(fieldFits("totp", input({ name: "q" }))).toBe(false);
  });
  test("desktop: inputs are picked by role and label from the real tree (GitHub sign-in, captured from a VM)", () => {
    // Trimmed from get_window_state (tree_format elements) on cua-spacesd 0.8.0 / Chromium, github.com/login.
    const github: AxElement[] = [
      {
        role: "entry",
        label: "Address and search bar",
        enabled: true,
        frame: { x: 162, y: 51, w: 894, h: 24 },
      },
      {
        role: "entry",
        label: "Username or email address",
        enabled: true,
        in_web_content: true,
        frame: { x: 467, y: 274, w: 353, h: 40 },
      },
      {
        role: "password text",
        label: "Password",
        enabled: true,
        in_web_content: true,
        frame: { x: 467, y: 355, w: 353, h: 40 },
      },
      {
        role: "link",
        label: "Forgot password?",
        enabled: true,
        in_web_content: true,
        frame: { x: 707, y: 330, w: 113, h: 21 },
      },
    ];
    expect(pickInput("password", github)?.label).toBe("Password");
    expect(pickInput("username", github)?.label).toBe("Username or email address");
    expect(pickInput("totp", github)).toBeUndefined();
    // the browser's own address bar is never a target, nor are search boxes, hidden or disabled inputs
    expect(
      pickInput("username", [
        github[0]!,
        { role: "entry", label: "Search", in_web_content: true, frame: { x: 1, y: 1, w: 9, h: 9 } },
      ]),
    ).toBeUndefined();
    expect(pickInput("password", [{ ...github[2]!, enabled: false }])).toBeUndefined();
    expect(
      pickInput("password", [{ ...github[2]!, frame: { x: 0, y: 0, w: 0, h: 0 } }]),
    ).toBeUndefined();
    // unlabelled username: the text field right before the password
    expect(pickInput("username", [{ ...github[1]!, label: "" }, github[2]!])?.frame?.y).toBe(274);
    expect(
      pickInput("totp", [
        {
          role: "entry",
          label: "Authentication code",
          in_web_content: true,
          enabled: true,
          frame: { x: 1, y: 1, w: 9, h: 9 },
        },
      ])?.label,
    ).toBe("Authentication code");
  });
});
