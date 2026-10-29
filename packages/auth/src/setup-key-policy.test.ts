import { describe, expect, test } from "bun:test";
import { createInvitationSignupPolicy } from "./invitation-policy";

const setup = (open: boolean) => ({
  isOpen: async () => open,
  verifyKey: (key: string) => key === "right-key",
  claim: async () => {},
  discard: async () => {},
});
const verify = async () => false;
const user = {
  id: "u1",
  name: "Ana",
  email: "ana@example.invalid",
  emailVerified: false,
  image: null,
  createdAt: new Date(),
  updatedAt: new Date(),
};
const run = (body: Record<string, unknown>, open = true) =>
  createInvitationSignupPolicy(verify, setup(open))(
    user as never,
    { path: "/sign-up/email", body } as never,
  );
const base = { name: "Ana", email: "ana@example.invalid", password: "correct horse battery" };

describe("first account sign-up proves ownership of the server", () => {
  test("allows the first sign-up with the right setup key", async () => {
    expect(await run({ ...base, setupKey: "right-key" })).toBeUndefined();
  });
  test("denies the first sign-up without a setup key", async () => {
    expect(await run(base)).toBe(false);
  });
  test("denies the first sign-up with a wrong setup key", async () => {
    expect(await run({ ...base, setupKey: "wrong-key" })).toBe(false);
  });
  test("denies the right setup key once setup is closed", async () => {
    expect(await run({ ...base, setupKey: "right-key" }, false)).toBe(false);
  });
});
