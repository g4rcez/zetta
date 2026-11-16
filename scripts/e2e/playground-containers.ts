// Runs one small script per language through the playground's container runner, with the real images (Bun, Python, bash),
// and checks what the playground promises: output, exit code, an out/ file, a read-only root, a stopped script.
// Needs a container engine (Podman or Docker) and a network to pull the images on the first run.
//   bun scripts/e2e/playground-containers.ts
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, rm } from "node:fs/promises";
import { homedir } from "node:os";
import { join } from "node:path";
import { engineOf } from "../../apps/server/src/modules/container-user";
import { LANGUAGES } from "../../apps/server/src/modules/playground/languages";
import { createContainerRunner } from "../../apps/server/src/modules/playground/runner-container";
import type { RunSpec } from "../../apps/server/src/modules/playground/types";
import { createReport } from "./report";

const report = createReport(
  "playground-containers",
  "Playground: container runners with their real images",
);
// A `docker` on the PATH may point at a daemon that is not running (Colima, Docker Desktop): take the first engine that answers.
async function workingEngine() {
  const candidates = [
    process.env.ZETTA_DOCKER_BIN,
    Bun.which("docker"),
    Bun.which("podman"),
    "/opt/podman/bin/podman",
    "/usr/local/bin/docker",
  ];
  for (const candidate of new Set(candidates)) {
    if (!candidate || !existsSync(candidate)) continue;
    const probe = Bun.spawn([candidate, "ps"], {
      stdin: "ignore",
      stdout: "ignore",
      stderr: "ignore",
      timeout: 15_000,
    });
    if ((await probe.exited) === 0) return candidate;
  }
  return undefined;
}
const bin = await workingEngine();
if (!bin) {
  report.skip("container engine", "no running Podman or Docker found (set ZETTA_DOCKER_BIN)");
  process.exit(report.finish("a container engine and a network for the first image pull"));
}

// The Podman machine shares the home folder with its VM and /var/folders with nothing, so the runs folder lives under home.
const root = join(homedir(), ".cache", "zetta-e2e");
await mkdir(root, { recursive: true });
const runsDir = await mkdtemp(join(root, "playground-"));
const runner = createContainerRunner({
  bin,
  engine: engineOf(bin),
  runsDir,
  prefix: `zetta-e2e-playground-${Math.random().toString(36).slice(2, 8)}-`,
  memory: "256m",
  cpus: "1",
  pids: 128,
  network: undefined,
  images: {},
});

const never = new AbortController().signal;
const spec = (
  language: RunSpec["language"],
  entry: string,
  content: string,
  timeoutMs = 60_000,
): RunSpec => ({
  language,
  entry,
  files: [{ path: entry, content }],
  inputs: { name: "Ada" },
  timeoutMs,
});

const programs: Record<string, { entry: string; code: string; expect: RegExp }> = {
  typescript: {
    entry: "main.ts",
    code: 'const n: string = JSON.parse(process.env.ZETTA_INPUTS ?? "{}").name;\nconsole.log(`hello ${n}`);\nawait Bun.write("out/a.txt", "report\\n");\n',
    expect: /^hello Ada$/m,
  },
  javascript: {
    entry: "main.js",
    code: 'const n = JSON.parse(process.env.ZETTA_INPUTS ?? "{}").name;\nconsole.log(`hello ${n}`);\nawait Bun.write("out/a.txt", "report\\n");\n',
    expect: /^hello Ada$/m,
  },
  python: {
    entry: "main.py",
    code: 'import json, os\nprint("hello " + json.loads(os.environ.get("ZETTA_INPUTS", "{}"))["name"])\nos.makedirs("out", exist_ok=True)\nopen("out/a.txt", "w").write("report\\n")\n',
    expect: /^hello Ada$/m,
  },
  bash: {
    entry: "main.sh",
    code: 'echo "hello Ada"\nmkdir -p out\necho report > out/a.txt\n',
    expect: /^hello Ada$/m,
  },
};

try {
  for (const [language, p] of Object.entries(programs)) {
    const image = LANGUAGES[language as keyof typeof LANGUAGES].cli?.image ?? "?";
    await report.check(`${language}: runs in ${image.split("/").pop()}`, async () => {
      const r = await runner.run(
        spec(language as RunSpec["language"], p.entry, p.code, 120_000),
        never,
      );
      if (r.status !== "ok")
        throw new Error(
          `status ${r.status}, exit ${r.exitCode}, stderr: ${r.stderr.slice(0, 160)}`,
        );
      if (!p.expect.test(r.stdout)) throw new Error(`unexpected stdout: ${r.stdout.slice(0, 120)}`);
      const file = r.outputs.find((o) => o.path === "a.txt");
      if (file?.content.toString() !== "report\n")
        throw new Error("the out/a.txt file did not come back");
      return `${r.runtimeVersion.split("\n")[0]?.slice(0, 40)}`;
    });
  }
  await report.check("a failing script reports its exit code (python)", async () => {
    const r = await runner.run(
      spec("python", "main.py", "import sys\nprint('oops', file=sys.stderr)\nsys.exit(7)\n"),
      never,
    );
    if (r.status !== "failed" || r.exitCode !== 7)
      throw new Error(`status ${r.status}, exit ${r.exitCode}`);
  });
  await report.check("the root file system is read-only (bash)", async () => {
    const r = await runner.run(
      spec("bash", "main.sh", "echo x > /etc/zetta-e2e 2>/dev/null\necho $?\n"),
      never,
    );
    if (r.stdout.trim() !== "1") throw new Error(`writing to /etc gave exit ${r.stdout.trim()}`);
  });
  await report.check("a script over its time limit is stopped (bun)", async () => {
    const r = await runner.run(
      spec("typescript", "main.ts", "await new Promise((r) => setTimeout(r, 30_000));\n", 2000),
      never,
    );
    if (r.status !== "timeout") throw new Error(`status ${r.status}`);
  });
} finally {
  await runner.sweep().catch(() => undefined);
  await rm(runsDir, { recursive: true, force: true });
}
report.note(
  `Engine: ${engineOf(bin)}. Images: ${Object.values(LANGUAGES)
    .flatMap((l) => (l.cli ? [l.cli.image] : []))
    .join(", ")}.`,
);
report.note(
  "Not covered: the network setting (`ZETTA_PLAYGROUND_NETWORK`), memory and process limits under load, and gVisor.",
);
process.exit(report.finish("a container engine and a network for the first image pull"));
