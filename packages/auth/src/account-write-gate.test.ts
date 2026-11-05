import { expect, test } from "bun:test";
import { createProfileWriteGate } from "./account-write-gate";
import { createInvitationSignupGate } from "./invitation-policy";

const run = (gate: unknown, path: string, body: unknown = {}) =>
  Reflect.apply(gate as never, undefined, [{ path, body }]);

test("the auth handler's own update-user is refused, whatever the body", async () => {
  const gate = createProfileWriteGate(createInvitationSignupGate(async () => true));
  for (const body of [{ name: "Ada" }, { image: "https://example.invalid/a.png" }, {}, undefined]) {
    await expect(run(gate, "/update-user", body)).rejects.toMatchObject({
      status: "FORBIDDEN",
      body: { code: "PROFILE_API_ONLY" },
    });
  }
});

test("other auth paths are left alone", async () => {
  const gate = createProfileWriteGate(createInvitationSignupGate(async () => true));
  for (const path of [
    "/change-password",
    "/revoke-other-sessions",
    "/sign-in/email",
    "/update-user/other",
  ]) {
    expect(await run(gate, path)).toBeUndefined();
  }
});

test("the signup gate still runs behind it", async () => {
  const gate = createProfileWriteGate(createInvitationSignupGate(async () => false));
  await expect(run(gate, "/sign-up/email", { email: "a@example.invalid" })).rejects.toMatchObject({
    status: "BAD_REQUEST",
    body: { code: "FAILED_TO_CREATE_USER" },
  });
});
