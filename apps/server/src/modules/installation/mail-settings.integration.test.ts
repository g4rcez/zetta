// The mail columns of the installation settings in a real database (ZETTA_TEST_DB=embedded; otherwise this skips).
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { installationSettings } from "@zetta/db/schema/installation";
import { createInstallationService, InvalidInstallationError, withLayaModel } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;

suite("bot e-mail settings against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const service = createInstallationService(db);
  let before: Awaited<ReturnType<typeof service.load>>;
  beforeAll(async () => {
    before = await service.load();
  });
  afterAll(async () => {
    await service.update({
      mailProvider: before.mailProvider,
      mailDomain: before.mailDomain,
      mailConnectionId: before.mailConnectionId,
      mailCursor: before.mailCursor,
    });
  });

  test("a provider and a domain are saved, the domain as a plain lower case name", async () => {
    const saved = await service.update({
      mailProvider: "resend",
      mailDomain: " @Bots.Example.invalid ",
    });
    expect(saved).toMatchObject({ mailProvider: "resend", mailDomain: "bots.example.invalid" });
    expect(await service.load()).toMatchObject({
      mailProvider: "resend",
      mailDomain: "bots.example.invalid",
    });
  });
  test("a provider without a domain, or a bad domain, is refused and nothing changes", async () => {
    await service.update({ mailProvider: "off", mailDomain: "" });
    await expect(service.update({ mailProvider: "resend" })).rejects.toBeInstanceOf(
      InvalidInstallationError,
    );
    await expect(
      service.update({ mailProvider: "off", mailDomain: "nope" }),
    ).rejects.toBeInstanceOf(InvalidInstallationError);
    expect(await service.load()).toMatchObject({ mailProvider: "off", mailDomain: "" });
  });
  test("the poller starts over when the provider or domain changes, not when anything else does", async () => {
    await service.update({
      mailProvider: "resend",
      mailDomain: "a.example.invalid",
      mailCursor: "r-9",
    });
    await service.update({ laya: "off" });
    expect((await service.load()).mailCursor).toBe("r-9");
    await service.update({ mailDomain: "b.example.invalid" });
    expect((await service.load()).mailCursor).toBeNull();
  });
  test("the answer to the web app holds neither the key's connection nor the cursor", async () => {
    const saved = await service.update({
      mailConnectionId: "0192f000-0000-7000-8000-000000000009",
      mailCursor: "r-1",
    });
    const view = JSON.stringify(withLayaModel(saved));
    expect(view).not.toContain("0192f000-0000-7000-8000-000000000009");
    expect(view).not.toContain("mailCursor");
    expect(view).not.toContain("mailConnectionId");
  });
  test("the database refuses a provider that is not on the list and a domain that is too long", async () => {
    await expect(
      Promise.resolve(
        db
          .update(installationSettings)
          .set({ mailProvider: "smtp" as never })
          .where(eq(installationSettings.id, 1)),
      ),
    ).rejects.toBeTruthy();
    await expect(
      Promise.resolve(
        db
          .update(installationSettings)
          .set({ mailDomain: "x".repeat(254) })
          .where(eq(installationSettings.id, 1)),
      ),
    ).rejects.toBeTruthy();
  });
});
