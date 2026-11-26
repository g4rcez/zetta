import { describe, expect, test } from "bun:test";
import {
  SECRETS_NOT_IMPORTED,
  SETTING_GROUPS,
  SETTING_KEY_MAX,
  SETTING_KEYS,
  SETTINGS,
  effective,
  isSettingKey,
  parseSettingValue,
  parseWithDef,
  settingDefault,
  settingFromEnv,
  settingMeta,
  type SettingKey,
} from "./settings";

describe("registry invariants", () => {
  test("every key has words, a group, a default that parses and a legacy variable", () => {
    expect(SETTING_KEYS.length).toBeGreaterThanOrEqual(20);
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key];
      expect(key.length).toBeLessThanOrEqual(SETTING_KEY_MAX);
      expect(/^[a-z][A-Za-z0-9]*$/.test(key)).toBe(true);
      expect(def.label.trim().length).toBeGreaterThan(3);
      expect(def.help.trim().length).toBeGreaterThan(20);
      expect(Object.keys(SETTING_GROUPS)).toContain(def.group);
      expect(def.applies).toBe("now");
      expect(def.env).toMatch(/^[A-Z][A-Z0-9_]+$/);
      const parsed = parseSettingValue(key, settingDefault(key));
      expect(parsed.ok).toBe(true);
      if (parsed.ok) expect(parsed.value).toEqual(settingDefault(key));
    }
  });

  test("no two keys replace the same variable", () => {
    const names = SETTING_KEYS.flatMap((k) => [
      SETTINGS[k].env,
      ...((SETTINGS[k] as { envAlso?: readonly string[] }).envAlso ?? []),
    ]);
    expect(new Set(names).size).toBe(names.length);
  });

  test("narrow entries are organization scoped and of a type that can be narrowed", () => {
    for (const key of SETTING_KEYS) {
      const def: (typeof SETTINGS)[SettingKey] = SETTINGS[key];
      const combine = (def as { combine?: string }).combine;
      if (def.scope === "organization") expect(["override", "narrow"]).toContain(combine as string);
      else expect(combine).toBeUndefined();
      if (combine === "narrow") expect(["switch", "integer", "list"]).toContain(def.type);
    }
  });

  test("security policy keys are sensitive and never overridable upward", () => {
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key] as { sensitive: boolean; scope: string; combine?: string };
      if (def.sensitive)
        expect(def.scope === "installation" || def.combine === "narrow").toBe(true);
    }
    expect(SETTINGS.allowPrivateNetwork.sensitive).toBe(true);
    expect(SETTINGS.allowPrivateNetwork.scope).toBe("installation");
    expect(SETTINGS.codeAccess.sensitive).toBe(true);
    expect(SETTINGS.codeAccess.combine).toBe("narrow");
  });

  test("no boolean anywhere: types are closed, defaults are strings, numbers and lists", () => {
    for (const key of SETTING_KEYS) {
      const def = SETTINGS[key];
      expect(["switch", "integer", "text", "list", "choice"]).toContain(def.type);
      expect(typeof def.default).not.toBe("boolean");
      if (def.type === "switch") expect(["on", "off"]).toContain(def.default);
    }
  });

  test("defaults are the values the code used with the variable unset", () => {
    const expected: Record<string, unknown> = {
      claudeLiveInput: "on",
      lightRuns: "off",
      memoryLearn: "on",
      lessonBatch: "on",
      embedding: "on",
      hostSkills: "off",
      mcpMemberStdio: "off",
      mcpAllowlist: [],
      harnessMax: 8,
      harnessMaxPerUser: 4,
      harnessWaitMs: 300_000,
      roomConcurrency: 4,
      artifactsQuota: 5 * 1024 ** 3,
      vmMaxPerUser: 4,
      vmMaxRunningPerUser: 2,
      vmMaxRunning: 6,
      vmDrivers: ["cua"],
      vmOs: ["debian"],
      allowPrivateNetwork: "off",
      codeAccess: "on",
      hostRunner: "auto",
      wahaUrl: "",
    };
    for (const [key, value] of Object.entries(expected))
      expect(settingDefault(key as SettingKey) as unknown).toEqual(value);
    expect(Object.keys(expected).sort()).toEqual([...(SETTING_KEYS as string[])].sort());
  });

  test("a default handed out is a copy", () => {
    const list = settingDefault("vmDrivers");
    list.push("agent-desktop");
    expect(settingDefault("vmDrivers")).toEqual(["cua"]);
  });

  test("the meta of a key carries no function and the default", () => {
    const meta = settingMeta("harnessMax");
    expect(meta).toMatchObject({ key: "harnessMax", type: "integer", default: 8, min: 1 });
    expect("fromEnv" in meta).toBe(false);
    expect(JSON.parse(JSON.stringify(meta))).toEqual(meta);
  });

  test("isSettingKey", () => {
    expect(isSettingKey("harnessMax")).toBe(true);
    expect(isSettingKey("toString")).toBe(false);
    expect(isSettingKey("__proto__")).toBe(false);
    expect(isSettingKey(3)).toBe(false);
  });
});

describe("parseSettingValue", () => {
  test("a switch takes the strings on and off, nothing else", () => {
    expect(parseSettingValue("lightRuns", "on")).toEqual({ ok: true, value: "on" });
    for (const bad of [true, false, 1, "yes", "ON", null, undefined, ["on"]]) {
      const r = parseSettingValue("lightRuns", bad);
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.error).toContain("on");
    }
  });

  test("an integer is a whole number inside its range", () => {
    expect(parseSettingValue("harnessMax", 12)).toEqual({ ok: true, value: 12 });
    expect(parseSettingValue("vmMaxPerUser", 0)).toEqual({ ok: true, value: 0 });
    for (const bad of [0, 1001, -1, 1.5, "8", Number.NaN, Number.POSITIVE_INFINITY, null]) {
      expect(parseSettingValue("harnessMax", bad).ok).toBe(false);
    }
    const r = parseSettingValue("harnessMax", 5000);
    expect(r.ok === false && r.error).toBe(
      '"Bot runs at once, in total" must be between 1 and 1000.',
    );
  });

  test("a list is trimmed, deduplicated, limited and checked against its options", () => {
    expect(parseSettingValue("vmDrivers", [" cua ", "cua", "agent-desktop", ""])).toEqual({
      ok: true,
      value: ["cua", "agent-desktop"],
    });
    expect(parseSettingValue("vmDrivers", []).ok).toBe(false);
    expect(parseSettingValue("vmDrivers", ["vnc"]).ok).toBe(false);
    expect(parseSettingValue("vmDrivers", "cua").ok).toBe(false);
    expect(parseSettingValue("vmOs", [1]).ok).toBe(false);
    expect(parseSettingValue("mcpAllowlist", []).ok).toBe(true);
    expect(parseSettingValue("mcpAllowlist", ["/usr/bin/npx -y some-mcp"])).toEqual({
      ok: true,
      value: ["/usr/bin/npx -y some-mcp"],
    });
    expect(parseSettingValue("mcpAllowlist", ["x".repeat(401)]).ok).toBe(false);
    expect(
      parseSettingValue(
        "mcpAllowlist",
        Array.from({ length: 65 }, (_, i) => `cmd${i}`),
      ).ok,
    ).toBe(false);
    expect(parseSettingValue("mcpAllowlist", ["a\nb"]).ok).toBe(false);
  });

  test("text and choice definitions (no registered key uses them yet)", () => {
    const text = {
      ...SETTINGS.harnessMax,
      type: "text",
      default: "",
      maxLength: 5,
    } as unknown as Parameters<typeof parseWithDef>[0];
    expect(parseWithDef(text, "  abc ")).toEqual({ ok: true, value: "abc" });
    expect(parseWithDef(text, "abcdef").ok).toBe(false);
    expect(parseWithDef(text, 3).ok).toBe(false);
    expect(parseWithDef(text, "a\u0000").ok).toBe(false);
    const choice = {
      ...SETTINGS.harnessMax,
      type: "choice",
      default: "a",
      options: ["a", "b"],
    } as unknown as Parameters<typeof parseWithDef>[0];
    expect(parseWithDef(choice, "b")).toEqual({ ok: true, value: "b" });
    const bad = parseWithDef(choice, "c");
    expect(bad.ok === false && bad.error).toContain("a, b");
  });
});

describe("effective", () => {
  test("nothing stored: the default", () => {
    expect(effective("harnessMax", {})).toEqual({ value: 8, source: "default" });
  });

  test("the installation value beats the default", () => {
    expect(effective("harnessMax", { installation: 3 })).toEqual({
      value: 3,
      source: "installation",
    });
  });

  test("override: the organization value wins, in either direction", () => {
    expect(effective("claudeLiveInput", { installation: "on", organization: "off" })).toEqual({
      value: "off",
      source: "organization",
    });
    expect(effective("claudeLiveInput", { installation: "off", organization: "on" })).toEqual({
      value: "on",
      source: "organization",
    });
    expect(effective("claudeLiveInput", { organization: "off" })).toEqual({
      value: "off",
      source: "organization",
    });
  });

  test("an installation-only key ignores an organization value", () => {
    expect(effective("harnessMax", { installation: 3, organization: 1 } as never)).toEqual({
      value: 3,
      source: "installation",
    });
    expect(
      effective("allowPrivateNetwork", { installation: "off", organization: "on" } as never),
    ).toEqual({ value: "off", source: "installation" });
  });

  test("narrow number: lower is taken, higher is refused", () => {
    expect(effective("artifactsQuota", { installation: 100, organization: 40 })).toEqual({
      value: 40,
      source: "organization",
    });
    expect(effective("artifactsQuota", { installation: 100, organization: 400 })).toEqual({
      value: 100,
      source: "installation",
    });
    expect(effective("harnessMaxPerUser", { organization: 9 })).toEqual({
      value: 4,
      source: "default",
    });
    expect(effective("harnessMaxPerUser", { organization: 2 })).toEqual({
      value: 2,
      source: "organization",
    });
    expect(effective("vmMaxPerUser", { organization: 0 })).toEqual({
      value: 0,
      source: "organization",
    });
  });

  test("narrow switch: off wins, on never raises", () => {
    expect(effective("codeAccess", { installation: "on", organization: "off" })).toEqual({
      value: "off",
      source: "organization",
    });
    expect(effective("codeAccess", { installation: "off", organization: "on" })).toEqual({
      value: "off",
      source: "installation",
    });
    expect(effective("memoryLearn", { organization: "on" })).toEqual({
      value: "on",
      source: "default",
    });
  });

  test("narrow list: only entries the installation offers survive", () => {
    expect(
      effective("vmDrivers", { installation: ["cua", "agent-desktop"], organization: ["cua"] }),
    ).toEqual({ value: ["cua"], source: "organization" });
    expect(
      effective("vmDrivers", { installation: ["cua"], organization: ["agent-desktop", "cua"] }),
    ).toEqual({ value: ["cua"], source: "installation" });
    expect(effective("vmOs", { organization: ["ubuntu"] })).toEqual({
      value: [],
      source: "organization",
    });
  });
});

describe("settingFromEnv: the old readers' meaning", () => {
  test("blank is nothing", () => {
    expect(settingFromEnv("harnessMax", "  ")).toBeUndefined();
    expect(settingFromEnv("lightRuns", "")).toBeUndefined();
  });
  test("on-unless-off switches", () => {
    expect(settingFromEnv("claudeLiveInput", "off")).toBe("off");
    expect(settingFromEnv("claudeLiveInput", "0")).toBe("on");
    expect(settingFromEnv("codeAccess", "host")).toBe("on");
    expect(settingFromEnv("codeAccess", "off")).toBe("off");
  });
  test("off-unless-on and off-unless-1 switches", () => {
    expect(settingFromEnv("lightRuns", "on")).toBe("on");
    expect(settingFromEnv("hostSkills", "1")).toBe("off");
    expect(settingFromEnv("mcpMemberStdio", "1")).toBe("on");
    expect(settingFromEnv("allowPrivateNetwork", "true")).toBe("off");
    expect(settingFromEnv("allowPrivateNetwork", "1")).toBe("on");
  });
  test("numbers come from digits only", () => {
    expect(settingFromEnv("harnessMax", "12")).toBe(12);
    expect(settingFromEnv("harnessMax", "twelve")).toBeUndefined();
    expect(settingFromEnv("harnessMax", "-3")).toBeUndefined();
  });
  test("lists split the way the old reader did", () => {
    expect(settingFromEnv("mcpAllowlist", "npx -y a; node b.js ;")).toEqual([
      "npx -y a",
      "node b.js",
    ]);
    expect(settingFromEnv("vmDrivers", "cua, agent-desktop")).toEqual(["cua", "agent-desktop"]);
    expect(settingFromEnv("vmDrivers", "cua, vnc")).toEqual(["cua"]);
    expect(settingFromEnv("vmOs", "vnc")).toBeUndefined();
  });
});

describe("wahaUrl", () => {
  test("is an installation text setting, not sensitive, empty by default, replacing ZETTA_WAHA_URL", () => {
    expect(SETTINGS.wahaUrl).toMatchObject({
      type: "text",
      scope: "installation",
      sensitive: false,
      default: "",
      env: "ZETTA_WAHA_URL",
    });
  });
  test("accepts empty (the built-in address) and an http or https address, trimmed", () => {
    expect(parseSettingValue("wahaUrl", "")).toEqual({ ok: true, value: "" });
    expect(parseSettingValue("wahaUrl", " http://waha.example.invalid:3000 ")).toEqual({
      ok: true,
      value: "http://waha.example.invalid:3000",
    });
    expect(parseSettingValue("wahaUrl", "https://waha.example.invalid/base")).toMatchObject({
      ok: true,
    });
  });
  test("refuses another scheme, no host, credentials in the address, and nonsense", () => {
    for (const bad of [
      "ftp://waha.example.invalid",
      "file:///etc/passwd",
      "javascript:alert(1)",
      "http://user:pw@waha.example.invalid",
      "waha.example.invalid",
      "not a url",
    ])
      expect(parseSettingValue("wahaUrl", bad).ok).toBe(false);
  });
  test("the key is not a setting: no registry entry holds a secret, and its variable is only warned about", () => {
    expect(Object.keys(SETTINGS).some((k) => /key|secret|token/i.test(k))).toBe(false);
    expect(SECRETS_NOT_IMPORTED.ZETTA_WAHA_API_KEY).toContain("Studio > Plugins > WhatsApp");
    expect(Object.values(SETTINGS).some((d) => (d.env as string) === "ZETTA_WAHA_API_KEY")).toBe(
      false,
    );
  });
});
