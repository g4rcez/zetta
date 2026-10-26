import { describe, expect, test } from "bun:test";
import { desktopFieldFits, desktopPage, fieldFits, originAllowed, originPattern } from "./credentials";

const input = (o: Partial<{ type: string; autocomplete: string; name: string; inputmode: string }>) => ({ tag: "input", type: "text", autocomplete: "", name: "", inputmode: "", ...o });

describe("credential origins", () => {
  test("patterns are normalized hosts; IPs, localhost and junk are refused", () => {
    expect(originPattern("https://GitHub.com/login?x=1")).toBe("github.com");
    expect(originPattern("*.Example.com")).toBe("*.example.com");
    expect(originPattern("accounts.google.com:443")).toBe("accounts.google.com");
    for (const bad of ["", "localhost", "127.0.0.1", "javascript:alert(1)", "*.com", "a b.com"]) expect(originPattern(bad)).toBeUndefined();
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
  test("desktop: the address bar gives the page, focus marks the input; unknown means refuse", () => {
    const tree = `- [0] frame "Sign in - Chromium"\n- [3] entry "Address and search bar" value="github.com/login"\n- [9] password text "Password" focused`;
    expect(desktopPage(tree)).toBe("https://github.com/login");
    expect(desktopPage(tree.replace("github.com/login", "https://github.com/x"))).toBe("https://github.com/x");
    expect(desktopPage(`${tree}\n- [4] push button "Not secure"`)).toBeUndefined();
    expect(desktopPage(`- [0] frame "Chromium"`)).toBeUndefined();
    expect(desktopFieldFits("password", tree)).toBe(true);
    expect(desktopFieldFits("username", tree)).toBe(false);
    expect(desktopFieldFits("username", `- [8] entry "Username or email address" focused`)).toBe(true);
    expect(desktopFieldFits("password", `- [8] entry "Comment" focused`)).toBe(false);
    expect(desktopFieldFits("password", `- [9] password text "Password"`)).toBe(false); // no focus marker: refuse
  });
});
