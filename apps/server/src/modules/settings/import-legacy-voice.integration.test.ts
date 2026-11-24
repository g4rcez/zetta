// The upgrade path of the voice variables that were removed (ZETTA_TRANSCRIBE, ZETTA_SPEECH_LOCAL and the model and language fallbacks):
// against a real database, because the point is what ends up in the installation settings row.
import { createDb } from "@zetta/db";
import { eq } from "@zetta/db/query";
import { installationSettings } from "@zetta/db/schema/installation";
import { afterAll, beforeEach, describe, expect, test } from "bun:test";
import { importLegacyVoiceSettings } from "./import-legacy-voice";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
const suite =
  url && (url.endsWith("/zetta_test") || process.env.ZETTA_TEST_DB === "embedded")
    ? describe
    : describe.skip;

suite("the legacy voice variables on the database", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const row = async () =>
    (await db.select().from(installationSettings).where(eq(installationSettings.id, 1)))[0];
  const reset = async () => {
    await db.delete(installationSettings).where(eq(installationSettings.id, 1));
  };
  const run = async (env: Record<string, string>) => {
    const logs: string[] = [];
    const warnings: string[] = [];
    const done = await importLegacyVoiceSettings({
      db,
      env,
      log: (m) => logs.push(m),
      warn: (m) => warnings.push(m),
    });
    return { done, logs, warnings };
  };
  beforeEach(reset);
  afterAll(async () => {
    await reset();
    await db.$client.end();
  });

  test("ZETTA_TRANSCRIBE=off becomes the provider `off` once, with the one-line log, and running twice changes nothing", async () => {
    const first = await run({ ZETTA_TRANSCRIBE: "off" });
    expect(first.done).toEqual([{ column: "transcribeProvider", env: "ZETTA_TRANSCRIBE" }]);
    expect(first.logs).toEqual([
      "installation setting transcribeProvider imported from ZETTA_TRANSCRIBE; it now lives in the database: remove the variable",
    ]);
    expect((await row())?.transcribeProvider).toBe("off");
    const second = await run({ ZETTA_TRANSCRIBE: "off" });
    expect(second.done).toEqual([]);
    expect(second.logs).toEqual([]);
    expect((await row())?.transcribeProvider).toBe("off");
  });

  test("it only fills the default: an administrator's choice is never overwritten, and another value of the variable is ignored", async () => {
    await db.insert(installationSettings).values({ id: 1, transcribeProvider: "openai" });
    expect((await run({ ZETTA_TRANSCRIBE: "off" })).done).toEqual([]);
    expect((await row())?.transcribeProvider).toBe("openai");
    await reset();
    expect((await run({ ZETTA_TRANSCRIBE: "on" })).done).toEqual([]);
    expect(await row()).toBeUndefined();
    // An installation that never set the variable keeps its default.
    await db.insert(installationSettings).values({ id: 1 });
    expect((await run({})).done).toEqual([]);
    expect((await row())?.transcribeProvider).toBe("local");
  });

  test("an existing row that holds the default is updated and keeps its other columns", async () => {
    await db.insert(installationSettings).values({ id: 1, transcribeLanguage: "pt" });
    await run({ ZETTA_TRANSCRIBE: "OFF" });
    const r = await row();
    expect(r?.transcribeProvider).toBe("off");
    expect(r?.transcribeLanguage).toBe("pt");
  });

  test("ZETTA_SPEECH_LOCAL=off turns the provider `local` into `off`, and touches no other provider", async () => {
    await db.insert(installationSettings).values({ id: 1, speechProvider: "local" });
    const r = await run({ ZETTA_SPEECH_LOCAL: "off" });
    expect(r.done).toEqual([{ column: "speechProvider", env: "ZETTA_SPEECH_LOCAL" }]);
    expect((await row())?.speechProvider).toBe("off");
    await reset();
    await db.insert(installationSettings).values({ id: 1, speechProvider: "openai" });
    expect((await run({ ZETTA_SPEECH_LOCAL: "off" })).done).toEqual([]);
    expect((await row())?.speechProvider).toBe("openai");
    await reset();
    await db.insert(installationSettings).values({ id: 1 });
    expect((await run({ ZETTA_SPEECH_LOCAL: "off" })).done).toEqual([]);
    expect((await row())?.speechProvider).toBe("browser");
  });

  test("the model and language fallbacks are kept as stored values only while the field is empty and the provider is local", async () => {
    await db.insert(installationSettings).values({ id: 1 });
    const env = {
      ZETTA_TRANSCRIBE_MODEL: "onnx-community/whisper-large-v3-turbo",
      ZETTA_TRANSCRIBE_LANGUAGE: "pt-BR",
      ZETTA_SPEECH_MODEL: "owner/kokoro-other",
    };
    // The voice is `browser`: its model is not touched; the speech to text is `local`.
    const first = await run(env);
    expect(first.done.map((d) => d.column).sort()).toEqual([
      "transcribeLanguage",
      "transcribeModel",
    ]);
    let r = await row();
    expect([r?.transcribeModel, r?.transcribeLanguage, r?.speechModel]).toEqual([
      "onnx-community/whisper-large-v3-turbo",
      "pt",
      "",
    ]);
    // A model an administrator chose is not replaced.
    await db
      .update(installationSettings)
      .set({ transcribeModel: "owner/mine", speechProvider: "local" })
      .where(eq(installationSettings.id, 1));
    const second = await run(env);
    expect(second.done).toEqual([{ column: "speechModel", env: "ZETTA_SPEECH_MODEL" }]);
    r = await row();
    expect([r?.transcribeModel, r?.speechModel]).toEqual(["owner/mine", "owner/kokoro-other"]);
    // A value that is not a repository (or a provider's own name) is never stored.
    await db
      .update(installationSettings)
      .set({ transcribeModel: "", transcribeLanguage: "" })
      .where(eq(installationSettings.id, 1));
    expect(
      (await run({ ZETTA_TRANSCRIBE_MODEL: "whisper-1", ZETTA_TRANSCRIBE_LANGUAGE: "tlh" })).done,
    ).toEqual([]);
  });

  test("a database that is not ready does not stop the start", async () => {
    const broken = {
      select: () => {
        throw new Error("relation does not exist");
      },
      insert: () => {
        throw new Error("relation does not exist");
      },
      update: () => {
        throw new Error("relation does not exist");
      },
    };
    const warnings: string[] = [];
    const done = await importLegacyVoiceSettings({
      db: broken as never,
      env: { ZETTA_TRANSCRIBE: "off" },
      log: () => {},
      warn: (m) => warnings.push(m),
    });
    expect(done).toEqual([]);
    expect(warnings[0]).toContain("voice settings import skipped");
  });
});
