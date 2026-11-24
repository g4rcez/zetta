// The real installation service with the phone settings, against Postgres (run with ZETTA_TEST_DB=embedded; without it this suite skips):
// what is stored, what is normalized, what is refused, and that a key's connection is recorded without the settings changing.
import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { installationSettings } from "@zetta/db/schema/installation";
import { InvalidInstallationError, createInstallationService, withLayaModel } from "./service";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite = url ? describe : describe.skip;
const good = {
  phoneProvider: "telnyx" as const,
  phonePublicKey: "cHVibGljLWtleS1mb3ItdGVzdHMtb25seS0wMDAwMDAwMA==",
  phonePublicUrl: "https://Zetta.Example.invalid/",
  phoneApplicationId: "1111111111111111111",
  phoneRequestMode: "operator_approval" as const,
  phoneCountries: "br, us ,BR",
};

suite("installation phone settings against postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const service = createInstallationService(db);
  beforeAll(async () => {
    await db.delete(installationSettings).where(eq(installationSettings.id, 1));
  });
  afterAll(async () => {
    await db.delete(installationSettings).where(eq(installationSettings.id, 1));
  });

  test("defaults: off, no countries, bounded limits", async () => {
    const s = await service.load();
    expect(s).toMatchObject({
      phoneProvider: "off",
      phoneRequestMode: "off",
      phoneCountries: "",
      phoneMaxNumbers: 5,
      phoneMaxCallMinutes: 30,
      phoneDailyMinutesPerBot: 60,
      phoneDailyCallsPerBot: 20,
      phoneConnectionId: null,
    });
  });

  test("a complete choice is saved normalized and read back", async () => {
    const saved = await service.update({ ...good, phoneMaxNumbers: 2 });
    expect(saved).toMatchObject({
      phoneProvider: "telnyx",
      phonePublicUrl: "https://zetta.example.invalid",
      phoneCountries: "BR,US",
      phoneMaxNumbers: 2,
    });
    expect(await service.load()).toEqual(saved);
  });

  test("an incomplete or invalid choice is refused and nothing is saved", async () => {
    const before = await service.load();
    for (const bad of [
      { phonePublicKey: "" },
      { phonePublicUrl: "" },
      { phoneApplicationId: "" },
      { phonePublicUrl: "http://zetta.example.invalid" },
      { phoneCountries: "brazil" },
      { phoneMaxCallMinutes: 0 },
      { phoneDailyCallsPerBot: 1001 },
    ])
      await expect(service.update(bad)).rejects.toBeInstanceOf(InvalidInstallationError);
    expect(await service.load()).toEqual(before);
  });

  test("recording a key's connection keeps the settings, and the view never carries the id", async () => {
    const id = "22222222-2222-7222-8222-222222222222";
    const after = await service.update({ phoneConnectionId: id });
    expect(after.phoneProvider).toBe("telnyx");
    expect(after.phoneConnectionId).toBe(id);
    const view = withLayaModel(after) as Record<string, unknown>;
    expect("phoneConnectionId" in view).toBe(false);
    expect(JSON.stringify(view)).not.toContain(id);
    const cleared = await service.update({ phoneConnectionId: null });
    expect(cleared.phoneConnectionId).toBeNull();
  });

  test("turning the provider off is allowed with its pieces still set", async () => {
    const off = await service.update({ phoneProvider: "off" });
    expect(off.phoneProvider).toBe("off");
    expect(off.phonePublicKey).toBe(good.phonePublicKey);
  });
});
