import { describe, expect, it } from "bun:test";
import { browserTimeZone, isTimeZone, personTitle, profileTextProblem } from "./person-profile";

describe("isTimeZone", () => {
  it("accepts real IANA names", () => {
    for (const z of ["America/Sao_Paulo", "Europe/Lisbon", "UTC", "America/Argentina/Buenos_Aires"])
      expect(isTimeZone(z)).toBe(true);
  });
  it("refuses made-up names, offsets and anything long", () => {
    for (const z of ["", "Mars/Base", "+02:00", "America/", "x".repeat(65), "Europe/Lisbon; drop"])
      expect(isTimeZone(z)).toBe(false);
  });
  it("the browser's zone is one of them", () => {
    expect(isTimeZone(browserTimeZone())).toBe(true);
  });
});

describe("profileTextProblem", () => {
  it("refuses HTML and control characters", () => {
    expect(profileTextProblem("<script>alert(1)</script>")).toBeDefined();
    expect(profileTextProblem("hi <b>there</b>")).toBeDefined();
    expect(profileTextProblem("bell\u0007")).toBeDefined();
  });
  it("lets plain text through, with line breaks only where allowed", () => {
    expect(profileTextProblem("a < b and c > d")).toBeUndefined();
    expect(profileTextProblem("one\ntwo")).toBeDefined();
    expect(profileTextProblem("one\ntwo", true)).toBeUndefined();
  });
});

describe("personTitle", () => {
  it("prefers what the person wrote, then the seat title", () => {
    expect(personTitle("Designer", "Head of design")).toBe("Designer");
    expect(personTitle("  ", "Head of design")).toBe("Head of design");
    expect(personTitle("", undefined)).toBe("");
  });
});
