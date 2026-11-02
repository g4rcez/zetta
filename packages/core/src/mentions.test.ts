import { describe, expect, it } from "bun:test";
import { isReservedBotName, mentionsUser } from "./mentions";

describe("isReservedBotName", () => {
  it("blocks the reserved names in any case or spacing", () => {
    expect(isReservedBotName("user")).toBe(true);
    expect(isReservedBotName("User")).toBe(true);
    expect(isReservedBotName("ALL")).toBe(true);
    expect(isReservedBotName("He re")).toBe(true);
    expect(isReservedBotName("  channel ")).toBe(true);
  });
  it("allows other names", () => {
    expect(isReservedBotName("Dredd")).toBe(false);
    expect(isReservedBotName("username")).toBe(false);
    expect(isReservedBotName("all-rounder")).toBe(false);
  });
});

describe("mentionsUser", () => {
  it("finds @user as a whole token", () => {
    expect(mentionsUser("@user, one question on D3.")).toBe(true);
    expect(mentionsUser("Me next.\n\n@User: please check")).toBe(true);
    expect(mentionsUser("ask (@user) now")).toBe(true);
  });
  it("ignores look-alikes", () => {
    expect(mentionsUser("@username is a bot")).toBe(false);
    expect(mentionsUser("write to a@user.com")).toBe(false);
    expect(mentionsUser("@Dredd and @DaVinci")).toBe(false);
    expect(mentionsUser("no mention")).toBe(false);
  });
});
