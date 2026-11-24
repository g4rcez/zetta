import { describe, expect, test } from "bun:test";
import { importEnvSettings } from "./import-env";
import { createSettingsService } from "./service";
import { createMemorySettingsStore } from "./testing";

const setup = () => {
  const store = createMemorySettingsStore();
  const logs: string[] = [];
  const warnings: string[] = [];
  const run = (env: Record<string, string | undefined>) =>
    importEnvSettings({ store, env, log: (m) => logs.push(m), warn: (m) => warnings.push(m) });
  const settings = createSettingsService({ store, now: () => 0 });
  return { store, logs, warnings, run, settings };
};

describe("import for upgraders", () => {
  test("a variable that is set becomes a stored value once, with the old reader's meaning", async () => {
    const { run, settings, logs } = setup();
    const result = await run({
      ZETTA_HARNESS_MAX: "12",
      ZETTA_LIGHT_RUNS: "on",
      ZETTA_CLAUDE_LIVE_INPUT: "off",
      ZETTA_MCP_MEMBER_STDIO: "1",
      ZETTA_ALLOW_PRIVATE_NETWORK: "1",
      ZETTA_CODE_ACCESS: "off",
      ZETTA_VM_DRIVERS: "cua,agent-desktop",
      ZETTA_MCP_ALLOWLIST: "npx -y a; node b.js",
      ZETTA_ARTIFACTS_QUOTA: "1073741824",
    });
    expect(result.imported.map((i) => i.key as string).sort()).toEqual(
      [
        "allowPrivateNetwork",
        "artifactsQuota",
        "claudeLiveInput",
        "codeAccess",
        "harnessMax",
        "lightRuns",
        "mcpAllowlist",
        "mcpMemberStdio",
        "vmDrivers",
      ].sort(),
    );
    expect(
      await settings.getMany([
        "harnessMax",
        "lightRuns",
        "claudeLiveInput",
        "mcpMemberStdio",
        "allowPrivateNetwork",
        "codeAccess",
        "vmDrivers",
        "mcpAllowlist",
        "artifactsQuota",
      ]),
    ).toEqual({
      harnessMax: 12,
      lightRuns: "on",
      claudeLiveInput: "off",
      mcpMemberStdio: "on",
      allowPrivateNetwork: "on",
      codeAccess: "off",
      vmDrivers: ["cua", "agent-desktop"],
      mcpAllowlist: ["npx -y a", "node b.js"],
      artifactsQuota: 1073741824,
    });
    expect((await settings.resolve("harnessMax")).source).toBe("imported");
    expect((await settings.resolve("embedding")).source).toBe("default");
    expect(logs).toContain(
      "setting harnessMax imported from ZETTA_HARNESS_MAX; it now lives in the database: remove the variable",
    );
    expect(logs.length).toBe(9);
  });

  test("nothing set, nothing stored", async () => {
    const { run, store } = setup();
    expect((await run({ ZETTA_HARNESS_MAX: "", ZETTA_LIGHT_RUNS: "  " })).imported).toEqual([]);
    expect((await store.readScope({ kind: "installation" })).size).toBe(0);
  });

  test("an existing row is never overwritten", async () => {
    const { run, store, settings } = setup();
    await store.upsert({ kind: "installation" }, "harnessMax", 3, "admin");
    const result = await run({ ZETTA_HARNESS_MAX: "12" });
    expect(result.imported).toEqual([]);
    settings.invalidate();
    expect(await settings.resolve("harnessMax")).toEqual({ value: 3, source: "installation" });
  });

  test("an unusable value is skipped with a warning, and the default stays", async () => {
    const { run, warnings, settings, logs } = setup();
    const result = await run({
      ZETTA_HARNESS_MAX: "lots",
      ZETTA_ROOM_CONCURRENCY: "5000",
      ZETTA_VM_DRIVERS: "vnc",
      ZETTA_ARTIFACTS_QUOTA: "-3",
    });
    expect(result.imported).toEqual([]);
    expect(result.skipped.map((s) => s.key).sort()).toEqual([
      "artifactsQuota",
      "harnessMax",
      "roomConcurrency",
      "vmDrivers",
    ]);
    expect(result.skipped.find((s) => s.key === "roomConcurrency")?.reason).toBe("invalid");
    expect(result.skipped.find((s) => s.key === "harnessMax")?.reason).toBe("unusable");
    expect(warnings.length).toBe(4);
    expect(warnings.join("\n")).not.toContain("lots");
    expect(logs).toEqual([]);
    expect(await settings.get("harnessMax")).toBe(8);
  });

  test("the old name of a variable is read when the new one is unset", async () => {
    const { run, settings } = setup();
    const result = await run({ ZETTA_WIKI_LEARN: "off" });
    expect(result.imported).toEqual([{ key: "memoryLearn", env: "ZETTA_WIKI_LEARN" }]);
    expect(await settings.get("memoryLearn")).toBe("off");
    const second = setup();
    await second.run({ ZETTA_MEMORY_LEARN: "on", ZETTA_WIKI_LEARN: "off" });
    expect(await second.settings.get("memoryLearn")).toBe("on");
  });

  test("running twice changes nothing", async () => {
    const { run, store, logs } = setup();
    const env = { ZETTA_HARNESS_MAX: "12", ZETTA_LIGHT_RUNS: "on" };
    await run(env);
    const before = JSON.stringify([...(await store.readScope({ kind: "installation" }))]);
    const again = await run(env);
    expect(again.imported).toEqual([]);
    expect(JSON.stringify([...(await store.readScope({ kind: "installation" }))])).toBe(before);
    expect(logs.length).toBe(2);
  });

  test("the value of a variable is never logged", async () => {
    const { run, logs } = setup();
    await run({ ZETTA_MCP_ALLOWLIST: "/opt/secret-tool --token=abc123" });
    expect(logs.join("\n")).not.toContain("abc123");
  });

  test("a database that is not ready (no table yet) does not stop the start", async () => {
    const store = createMemorySettingsStore();
    store.insertMissing = async () => {
      throw new Error('relation "zetta.setting" does not exist');
    };
    const warnings: string[] = [];
    const result = await importEnvSettings({
      store,
      env: { ZETTA_HARNESS_MAX: "9" },
      warn: (m) => warnings.push(m),
    });
    expect(result.imported).toEqual([]);
    expect(warnings[0]).toContain("settings import skipped");
  });
});

describe("the WhatsApp server", () => {
  test("ZETTA_WAHA_URL is imported once as the setting wahaUrl", async () => {
    const { run, settings, logs } = setup();
    const result = await run({ ZETTA_WAHA_URL: "http://waha.example.invalid:3000" });
    expect(result.imported).toEqual([{ key: "wahaUrl", env: "ZETTA_WAHA_URL" }]);
    expect(await settings.get("wahaUrl")).toBe("http://waha.example.invalid:3000");
    expect((await settings.resolve("wahaUrl")).source).toBe("imported");
    expect(logs.join("\n")).toContain("setting wahaUrl imported from ZETTA_WAHA_URL");
  });

  test("an address that is not http(s) is skipped with a warning", async () => {
    const { run, settings, warnings } = setup();
    const result = await run({ ZETTA_WAHA_URL: "ftp://waha.example.invalid" });
    expect(result.skipped).toEqual([{ key: "wahaUrl", env: "ZETTA_WAHA_URL", reason: "invalid" }]);
    expect(warnings).toHaveLength(1);
    expect(await settings.get("wahaUrl")).toBe("");
  });

  test("ZETTA_WAHA_API_KEY is never imported: a warning says to save the key in Studio, and the value is never logged", async () => {
    const { run, store, logs, warnings } = setup();
    const result = await run({ ZETTA_WAHA_API_KEY: "waha-secret-value" });
    expect(result.imported).toEqual([]);
    expect([...(await store.readScope({ kind: "installation" }))]).toEqual([]);
    expect(warnings).toHaveLength(1);
    expect(warnings[0]).toContain("ZETTA_WAHA_API_KEY");
    expect(warnings[0]).toContain("Studio");
    expect([...logs, ...warnings].join("\n")).not.toContain("waha-secret-value");
    // Not set: no warning.
    const quiet = setup();
    await quiet.run({});
    expect(quiet.warnings).toEqual([]);
  });
});

describe("the speech keys that used to be read from the environment", () => {
  test("ZETTA_TRANSCRIBE_API_KEY and ZETTA_SPEECH_API_KEY are ignored with a clear warning each, and the value is never logged", async () => {
    const { run, store, logs, warnings } = setup();
    const result = await run({
      ZETTA_TRANSCRIBE_API_KEY: "sk-test-stt-value",
      ZETTA_SPEECH_API_KEY: "sk-test-tts-value",
    });
    expect(result.imported).toEqual([]);
    expect([...(await store.readScope({ kind: "installation" }))]).toEqual([]);
    expect(warnings).toHaveLength(2);
    expect(warnings.find((w) => w.includes("ZETTA_TRANSCRIBE_API_KEY"))).toContain("is ignored");
    expect(warnings.find((w) => w.includes("ZETTA_TRANSCRIBE_API_KEY"))).toContain(
      "Studio > Voice > Speech to text",
    );
    expect(warnings.find((w) => w.includes("ZETTA_SPEECH_API_KEY"))).toContain(
      "Studio > Voice > Text to speech",
    );
    expect([...logs, ...warnings].join("\n")).not.toContain("sk-test-");
  });
});
