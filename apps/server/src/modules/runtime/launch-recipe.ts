import { createHash } from "node:crypto";
import { z } from "zod";
import { digestLaunchSpec, LaunchSpecError } from "./launch-spec";
import type { LaunchSpec } from "./launch-spec";

const id = z.string().regex(/^[a-zA-Z0-9_-]{1,128}$/);
const policySchema = z.strictObject({
  installationId: id.brand<"LauncherInstallationId">(), policyVersion: id,
  image: z.string().regex(/^sha256:[a-f0-9]{64}$/).brand<"FixtureImageDigest">(),
}).readonly().brand<"FixtureLaunchPolicy">();
export type FixtureLaunchPolicy = z.infer<typeof policySchema>;

export function createFixtureLaunchPolicy(raw: unknown): FixtureLaunchPolicy {
  const result = policySchema.safeParse(raw);
  if (!result.success) throw new LaunchSpecError("invalid_policy");
  return result.data;
}

const emptyList = Object.freeze([]);
const emptyObject = Object.freeze({});
const environment = Object.freeze([
  "PATH=/usr/local/bin:/usr/bin:/bin", "HOME=/scratch/home", "XDG_CONFIG_HOME=/scratch/home/.config",
  "XDG_CACHE_HOME=/scratch/cache", "LANG=C.UTF-8",
]);
const hostConfig = Object.freeze({
  NetworkMode: "none", PidMode: "", IpcMode: "none", CgroupnsMode: "private", UTSMode: "", UsernsMode: "",
  Privileged: false, ReadonlyRootfs: true, CapDrop: Object.freeze(["ALL"]), CapAdd: emptyList,
  SecurityOpt: Object.freeze(["no-new-privileges"]),
  Memory: 134_217_728, MemorySwap: 134_217_728, NanoCpus: 1_000_000_000, PidsLimit: 32,
  Tmpfs: Object.freeze({ "/scratch": "rw,noexec,nosuid,nodev,size=16777216,mode=1777" }),
  Mounts: emptyList, Binds: emptyList, VolumesFrom: emptyList, Devices: emptyList, DeviceRequests: emptyList,
  PortBindings: emptyObject, PublishAllPorts: false, ExtraHosts: emptyList, Links: emptyList,
  GroupAdd: emptyList, Sysctls: emptyObject,
  RestartPolicy: Object.freeze({ Name: "no", MaximumRetryCount: 0 }),
  LogConfig: Object.freeze({ Type: "none", Config: emptyObject }),
});

export function expandFixtureRecipe(spec: LaunchSpec, policy: FixtureLaunchPolicy) {
  if (spec.policyVersion !== policy.policyVersion) throw new LaunchSpecError("unsupported_policy");
  const specDigest = digestLaunchSpec(spec);
  const identityDigest = createHash("sha256").update(JSON.stringify([
    "zetta.launch.recipe", 1, "linux-systemd-v1", policy.installationId, policy.policyVersion, policy.image, specDigest,
  ]), "utf8").digest("hex");
  const container = Object.freeze({
    Image: policy.image, Entrypoint: Object.freeze(["/usr/local/bin/bun"]),
    Cmd: Object.freeze(["--no-env-file", "/opt/zetta/fixture.ts", spec.fixtureCase]), Env: environment,
    // The trusted fixture must create fresh home/work directories with mode 0700 and
    // chdir to /scratch/work before reading input or executing fixture behavior.
    User: "65534:65534", WorkingDir: "/scratch", Tty: false,
    AttachStdin: true, AttachStdout: true, AttachStderr: true, OpenStdin: true, StdinOnce: true,
    Volumes: emptyObject, ExposedPorts: emptyObject, Healthcheck: Object.freeze({ Test: Object.freeze(["NONE"]) }),
    HostConfig: hostConfig,
  });
  return Object.freeze({ deploymentProfile: "linux-systemd-v1", installationId: policy.installationId, policyVersion: policy.policyVersion, spec, specDigest, identityDigest, container });
}

export type FixtureLaunchRecipe = ReturnType<typeof expandFixtureRecipe>;
