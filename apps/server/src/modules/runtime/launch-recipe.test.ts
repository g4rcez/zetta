import { expect, test } from "bun:test";
import { parseLaunchSpec } from "./launch-spec";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";

const raw = () => ({
  version: 1,
  context: {
    actorId: "actor-a",
    runId: "run-a",
    attemptId: "attempt-a",
    botId: "bot-a",
    conversationId: "chat-a",
    configurationId: "config-a",
  },
  leaseId: "lease-a",
  fence: 1,
  recipe: "fixture-v1",
  fixtureCase: "echo",
  policyVersion: "fixture-policy-1",
  deadlineEpochMs: 31_000,
  budgets: {
    deadlineMs: 30_000,
    maxInputBytes: 65_536,
    maxOutputBytes: 65_536,
    maxFrameBytes: 8_192,
  },
});
const policyInput = () => ({
  installationId: "install-a",
  policyVersion: "fixture-policy-1",
  image: `sha256:${"1".repeat(64)}`,
});
const admission = {
  nowEpochMs: 1_000,
  authorizedDeadlineEpochMs: 61_000,
  policyVersion: "fixture-policy-1",
};

for (const change of [
  { image: "bun:latest" },
  { image: `sha256:${"a".repeat(63)}` },
  { image: `sha256:${"G".repeat(64)}` },
  { installationId: "../host" },
  { policyVersion: "" },
  { environment: {} },
  { executable: "/bin/sh" },
]) {
  test("denies invalid or authority-extending trusted policy configuration", () => {
    // Given / When / Then
    expect(() => createFixtureLaunchPolicy({ ...policyInput(), ...change })).toThrow(
      "invalid_policy",
    );
  });
}

test("copies policy so later caller changes cannot substitute image or installation", () => {
  // Given
  const source = policyInput();
  const spec = parseLaunchSpec(raw(), admission);
  const policy = createFixtureLaunchPolicy(source);
  // When
  source.image = `sha256:${"2".repeat(64)}`;
  source.installationId = "install-b";
  const recipe = expandFixtureRecipe(spec, policy);
  // Then
  expect(String(recipe.container.Image)).toBe(`sha256:${"1".repeat(64)}`);
  expect(String(recipe.installationId)).toBe("install-a");
  expect(Object.isFrozen(policy)).toBe(true);
});

for (const fixtureCase of ["echo", "wait", "fork", "term-resistant", "flood"] as const) {
  test(`expands only the selected fixture behavior ${fixtureCase} without command interpolation`, () => {
    // Given
    const spec = parseLaunchSpec({ ...raw(), fixtureCase }, admission);
    // When
    const recipe = expandFixtureRecipe(spec, createFixtureLaunchPolicy(policyInput()));
    // Then
    expect(recipe.container.Entrypoint).toEqual(["/usr/local/bin/bun"]);
    expect(recipe.container.Cmd).toEqual(["--no-env-file", "/opt/zetta/fixture.ts", fixtureCase]);
    expect(recipe.spec).toBe(spec);
  });
}

test("describes a bounded private container with no host resources or network route", () => {
  // Given
  const spec = parseLaunchSpec(raw(), admission);
  // When
  const { container } = expandFixtureRecipe(spec, createFixtureLaunchPolicy(policyInput()));
  // Then
  expect(container.User).toBe("65534:65534");
  expect(container.WorkingDir).toBe("/scratch");
  expect(container.Env).toEqual([
    "PATH=/usr/local/bin:/usr/bin:/bin",
    "HOME=/scratch/home",
    "XDG_CONFIG_HOME=/scratch/home/.config",
    "XDG_CACHE_HOME=/scratch/cache",
    "LANG=C.UTF-8",
  ]);
  expect(container.HostConfig).toMatchObject({
    NetworkMode: "none",
    PidMode: "",
    IpcMode: "none",
    CgroupnsMode: "private",
    UTSMode: "",
    UsernsMode: "",
    Privileged: false,
    ReadonlyRootfs: true,
    CapDrop: ["ALL"],
    CapAdd: [],
    SecurityOpt: ["no-new-privileges"],
    Memory: 134_217_728,
    MemorySwap: 134_217_728,
    NanoCpus: 1_000_000_000,
    PidsLimit: 32,
    Mounts: [],
    Binds: [],
    VolumesFrom: [],
    Devices: [],
    DeviceRequests: [],
    PortBindings: {},
    PublishAllPorts: false,
    ExtraHosts: [],
    Links: [],
    GroupAdd: [],
    Sysctls: {},
    RestartPolicy: { Name: "no" },
    LogConfig: { Type: "none" },
  });
  expect(container.HostConfig.Tmpfs).toEqual({
    "/scratch": "rw,noexec,nosuid,nodev,size=16777216,mode=1777",
  });
  expect(container.Volumes).toEqual({});
  expect(container.ExposedPorts).toEqual({});
  expect(container.Healthcheck.Test).toEqual(["NONE"]);
});

test("freezes every descriptor subtree so recipe settings cannot be replaced after admission", () => {
  // Given
  const recipe = expandFixtureRecipe(
    parseLaunchSpec(raw(), admission),
    createFixtureLaunchPolicy(policyInput()),
  );
  const objects: object[] = [recipe];
  // When
  for (const object of objects) {
    for (const value of Object.values(object))
      if (typeof value === "object" && value !== null) objects.push(value);
  }
  // Then
  expect(objects.every(Object.isFrozen)).toBe(true);
  expect(Reflect.set(recipe.container.HostConfig, "NetworkMode", "host")).toBe(false);
  expect(recipe.container.HostConfig.NetworkMode).toBe("none");
  expect(Reflect.set(recipe.container, "WorkingDir", "/scratch/work")).toBe(false);
  expect(recipe.container.WorkingDir).toBe("/scratch");
});

test("binds identity to the exact installation, image and admitted policy revision", () => {
  // Given
  const spec = parseLaunchSpec(raw(), admission);
  const policies = [
    policyInput(),
    { ...policyInput(), installationId: "install-b" },
    { ...policyInput(), image: `sha256:${"2".repeat(64)}` },
  ];
  // When
  const recipes = policies.map((policy) =>
    expandFixtureRecipe(spec, createFixtureLaunchPolicy(policy)),
  );
  const policyVersion = "fixture-policy-2";
  recipes.push(
    expandFixtureRecipe(
      parseLaunchSpec({ ...raw(), policyVersion }, { ...admission, policyVersion }),
      createFixtureLaunchPolicy({ ...policyInput(), policyVersion }),
    ),
  );
  // Then
  expect(new Set(recipes.map((recipe) => recipe.identityDigest)).size).toBe(4);
  expect(new Set(recipes.map((recipe) => recipe.specDigest)).size).toBe(2);
});

test("rejects expansion using a policy version different from admission", () => {
  // Given
  const spec = parseLaunchSpec(raw(), admission);
  const policy = createFixtureLaunchPolicy({ ...policyInput(), policyVersion: "fixture-policy-2" });
  // When / Then
  expect(() => expandFixtureRecipe(spec, policy)).toThrow("unsupported_policy");
});
