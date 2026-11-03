import { chmod, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, test } from "bun:test";
import {
  type AgentProfile,
  HarnessError,
  claudeArgs,
  codeWorkspace,
  createLimiter,
  defaultLimiter,
  botEmail,
  dockerArgs,
  ghLoggedIn,
  gitIdentity,
  gitEnv,
  harnessCommands,
  harnessHome,
  harnessMessage,
  runCli,
  streamCli,
} from "./harness";

async function script(body: string) {
  const dir = await mkdtemp(join(tmpdir(), "zetta-fake-"));
  const path = join(dir, "fake");
  await writeFile(path, `#!/bin/sh\n${body}\n`);
  await chmod(path, 0o755);
  return path;
}
describe("cli harness", () => {
  test("every native harness builds an argv with the prompt as one element", () => {
    for (const h of Object.keys(harnessCommands) as (keyof typeof harnessCommands)[]) {
      const argv = harnessCommands[h]("hello; rm -rf /", "m1");
      expect(argv.at(-1)).toBe("hello; rm -rf /");
      expect(argv).toContain("m1");
    }
  });
  test("returns stdout, runs in an empty cwd with a minimal env", async () => {
    const fake = await script(
      'echo "cwd=$(ls | wc -l | tr -d " ") secret=${ZETTA_SECRET:-none} arg=$2"',
    );
    process.env.ZETTA_SECRET = "leak";
    const out = await runCli({
      harness: "pi",
      prompt: "hi",
      model: null,
      resolve: () => fake,
    });
    expect(out).toBe("cwd=0 secret=none arg=hi");
  });
  test("maps missing binary, failure and timeout to typed errors", async () => {
    const code = (p: Promise<unknown>) =>
      p.then(
        () => "ok",
        (e) => (e as HarnessError).code,
      );
    const failing = await script("exit 3");
    expect(
      await code(runCli({ harness: "pi", prompt: "x", model: null, resolve: () => null })),
    ).toBe("not_installed");
    expect(
      await code(runCli({ harness: "pi", prompt: "x", model: null, resolve: () => failing })),
    ).toBe("failed");
    const slow = await script("sleep 5");
    expect(
      await code(
        runCli({ harness: "pi", prompt: "x", model: null, timeoutMs: 200, resolve: () => slow }),
      ),
    ).toBe("timeout");
  });
  test("timeout kills the whole process tree, not only the child", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zetta-tree-"));
    const marker = join(dir, "alive");
    const fake = await script(`(sleep 1; echo x > ${marker}) &\nsleep 30`);
    const code = await runCli({
      harness: "pi",
      prompt: "x",
      model: null,
      timeoutMs: 200,
      resolve: () => fake,
    }).then(
      () => "ok",
      (e) => (e as HarnessError).code,
    );
    expect(code).toBe("timeout");
    await Bun.sleep(1500);
    expect(await Bun.file(marker).exists()).toBe(false); // the grandchild was killed too
  });
  test("a run without an explicit deadline is never stopped for taking long", async () => {
    const fake = await script("sleep 1; echo finished");
    const out = await runCli({ harness: "pi", prompt: "x", model: null, resolve: () => fake });
    expect(out).toBe("finished");
  });
  test("a long run stops holding its concurrency slot so other chats can start", async () => {
    process.env.ZETTA_HARNESS_SLOT_MS = "100";
    try {
      const long = await script("sleep 2; echo long");
      const quick = await script("echo quick");
      const user = "slot-user";
      const runs = [long, long, quick].map((f) =>
        runCli({ harness: "pi", prompt: "x", model: null, userId: user, resolve: () => f }).then(
          (t) => t,
          (e: HarnessError) => e.code,
        ),
      );
      const first = await Promise.race(runs);
      expect(first).toBe("quick");
    } finally {
      delete process.env.ZETTA_HARNESS_SLOT_MS;
    }
  });
  test("claude code resumes a workspace session by id and names new ones", () => {
    const fresh = claudeArgs("go", null, "git", undefined, undefined, {
      id: "sess-1",
      resume: false,
    });
    expect(fresh).toContain("--session-id");
    expect(fresh[fresh.indexOf("--session-id") + 1]).toBe("sess-1");
    expect(fresh).not.toContain("--resume");
    const again = claudeArgs("go", null, "git", undefined, undefined, {
      id: "sess-1",
      resume: true,
    });
    expect(again[again.indexOf("--resume") + 1]).toBe("sess-1");
    expect(again).not.toContain("--session-id");
    expect(
      claudeArgs("go", null, undefined, undefined, undefined, { id: "sess-1", resume: false }),
    ).not.toContain("--session-id");
  });
  test("claude code gets the bound MCP servers next to its own, limited to the allowed tools", () => {
    const mcp = {
      servers: {
        files: {
          type: "http" as const,
          url: "https://mcp.example.test/mcp",
          headers: { Authorization: "Bearer ${ZETTA_MCP_TOKEN_0}" },
        },
      },
      allow: ["mcp__files__echo"],
    };
    for (const mode of [undefined, "git"] as const) {
      const args = claudeArgs("go", null, mode, undefined, undefined, undefined, false, mcp);
      expect(args).toContain(
        '--mcp-config={"mcpServers":{"files":{"type":"http","url":"https://mcp.example.test/mcp","headers":{"Authorization":"Bearer ${ZETTA_MCP_TOKEN_0}"}}}}',
      );
      expect(args.find((a) => a.startsWith("--allowedTools="))).toContain("mcp__files__echo");
      expect(args).not.toContain("--strict-mcp-config");
      expect(args.at(-1)).toBe("go");
    }
    expect(claudeArgs("go", null).some((a) => a.startsWith("--mcp-config"))).toBe(false);
  });
  test("an abort signal cancels the run", async () => {
    const slow = await script("sleep 30");
    const ac = new AbortController();
    setTimeout(() => ac.abort(), 100);
    const code = await runCli({
      harness: "pi",
      prompt: "x",
      model: null,
      signal: ac.signal,
      resolve: () => slow,
    }).then(
      () => "ok",
      (e) => (e as HarnessError).code,
    );
    expect(code).toBe("cancelled");
  });
  test("auth failures are classified without leaking stderr; other failures stay generic", async () => {
    const authFake = await script('echo "Error: Not logged in. Please run /login" >&2; exit 1');
    const other = await script('echo "boom /secret/path" >&2; exit 1');
    const run = (p: string) =>
      runCli({ harness: "claude-code", prompt: "x", model: null, resolve: () => p }).then(
        () => "ok",
        (e: HarnessError) => e,
      );
    const a = (await run(authFake)) as HarnessError,
      o = (await run(other)) as HarnessError;
    expect(a.code).toBe("auth_required");
    expect(o.code).toBe("failed");
    expect(harnessMessage("claude-code", a.code)).not.toContain("login");
    expect(harnessMessage("pi", "not_installed")).toContain("not installed");
  });
  test("a thread over the per-user cap waits for a free slot and then runs", async () => {
    const lim = createLimiter({ global: 8, perUser: 1, waitMs: 5_000 });
    const first = await lim.acquire("a");
    let started = false;
    const second = lim.acquire("a").then((release) => {
      started = true;
      return release;
    });
    await new Promise((r) => setTimeout(r, 250));
    expect(started).toBe(false);
    first();
    (await second)();
    expect(started).toBe(true);
  });
  test("the default limiter lets one user run four threads at once", async () => {
    const releases = [];
    for (const _ of [1, 2, 3, 4]) releases.push(await defaultLimiter.acquire("default-limit-user"));
    expect(defaultLimiter.stats().active).toBe(4);
    for (const r of releases) r();
  });
  test("limiter caps per-user and global concurrency and reports busy", async () => {
    const lim = createLimiter({ global: 2, perUser: 1, waitMs: 150 });
    const r1 = await lim.acquire("a");
    expect(
      await lim.acquire("a").then(
        () => "ok",
        (e) => e.code,
      ),
    ).toBe("busy"); // per-user
    const r2 = await lim.acquire("b");
    expect(
      await lim.acquire("c").then(
        () => "ok",
        (e) => e.code,
      ),
    ).toBe("busy"); // global
    r1();
    r2();
    const r3 = await lim.acquire("a");
    r3();
  });
  test("per-user HOME isolates native logins when configured", async () => {
    expect(harnessHome("u1", "codex", "/data/homes")).toBe("/data/homes/u1/codex");
    expect(harnessHome("../evil", "codex", "/data/homes")).toBe("/data/homes/___evil/codex");
    expect(harnessHome("u1", "codex", undefined)).toBeUndefined();
    const root = await mkdtemp(join(tmpdir(), "zetta-homes-"));
    process.env.ZETTA_HARNESS_HOME_ROOT = root;
    const fake = await script('echo "home=$HOME"');
    const out = (u: string) =>
      runCli({ harness: "pi", prompt: "x", model: null, userId: u, resolve: () => fake });
    expect(await out("alice")).toBe(`home=${root}/alice/pi`);
    expect(await out("bob")).toBe(`home=${root}/bob/pi`);
    delete process.env.ZETTA_HARNESS_HOME_ROOT;
  });
  test("claude code: steps reach onActivity, the result is the reply, and the notes are not", async () => {
    const fake = await script(`cat <<'JSON'
{"type":"system","subtype":"init"}
{"type":"assistant","message":{"content":[{"type":"text","text":"I will look at the file."},{"type":"tool_use","name":"Read","input":{"file_path":"/srv/a/notes.md"}}]}}
{"type":"user","message":{"content":[{"type":"tool_result"}]}}
{"type":"assistant","message":{"content":[{"type":"text","text":"All done."}]}}
{"type":"result","subtype":"success","is_error":false,"result":"All done."}
JSON`);
    const steps: string[] = [];
    const out = await runCli({
      harness: "claude-code",
      prompt: "x",
      model: null,
      resolve: () => fake,
      onActivity: (l) => steps.push(l),
    });
    expect(out).toBe("All done.");
    expect(steps).toEqual(["I will look at the file.", "Reading notes.md"]);
  });
  test("claude code: an error result is classified from its text", async () => {
    const fake = await script(`cat <<'JSON'
{"type":"result","subtype":"success","is_error":true,"result":"Invalid API key · Please run /login"}
JSON
exit 1`);
    const err = await runCli({
      harness: "claude-code",
      prompt: "x",
      model: null,
      resolve: () => fake,
    }).then(
      () => undefined,
      (e: HarnessError) => e.code,
    );
    expect(err).toBe("auth_required");
  });
  test("a silent run reports 'Still working' once, then still returns its reply", async () => {
    const fake = await script("sleep 1.2; echo done");
    const items: unknown[] = [];
    for await (const c of streamCli({
      harness: "pi",
      prompt: "x",
      model: null,
      heartbeatMs: 500,
      resolve: () => fake,
    }))
      items.push(c);
    expect(items).toEqual([{ activity: "Still working" }, "done\n"]);
  });
  test("a claude code run that goes quiet after a step repeats that step in the heartbeat", async () => {
    const fake = await script(`cat <<'JSON'
{"type":"assistant","message":{"content":[{"type":"tool_use","name":"Grep","input":{"pattern":"TODO"}}]}}
JSON
sleep 1.2
cat <<'JSON'
{"type":"result","subtype":"success","is_error":false,"result":"Found 3."}
JSON`);
    const items: unknown[] = [];
    for await (const c of streamCli({
      harness: "claude-code",
      prompt: "x",
      model: null,
      heartbeatMs: 500,
      resolve: () => fake,
    }))
      items.push(c);
    expect(items).toEqual([
      { activity: 'Searching "TODO"' },
      { activity: 'Still working · Searching "TODO"' },
      "Found 3.",
    ]);
  });
  test("streams chunks as they arrive", async () => {
    const fake = await script("echo one; sleep 0.2; echo two");
    const parts: string[] = [];
    for await (const c of streamCli({
      harness: "pi",
      prompt: "x",
      model: null,
      resolve: () => fake,
    }))
      if (typeof c === "string") parts.push(c);
    expect(parts.join("")).toContain("one");
    expect(parts.join("")).toContain("two");
  });
});

describe("code access", () => {
  test("a bot with a bound GitHub token may run gh without a second grant", () => {
    const withToken = claudeArgs("go", null, "git", undefined, undefined, undefined, true).join(
      " ",
    );
    expect(withToken).toContain("Bash(gh:*)");
    expect(
      claudeArgs("go", null, "git", { preset: "edit" } as never, undefined, undefined, true).join(
        " ",
      ),
    ).toContain("Bash(git:*)");
    const without = claudeArgs("go", null, "git").join(" ");
    expect(without).not.toContain("Bash(gh:*)");
  });

  test("without a workspace, GitHub through the gh login allows gh and nothing else of the shell", () => {
    const chat = claudeArgs("go", null, undefined, undefined, undefined, undefined, true).join(" ");
    expect(chat).toContain("--allowedTools=Bash(gh:*)");
    expect(chat).not.toContain("Bash(git:*)");
    expect(claudeArgs("go", null).join(" ")).not.toContain("Bash");
  });

  test("a host run honours granted rules, including interpreters and scripts", () => {
    const profile: AgentProfile = {
      preset: "git",
      allow: ["Bash(gh pr create:*)", "Bash(python3:*)", "Bash(bash /tmp/fetch.sh)"],
      deny: [],
      appendPrompt: "",
      effort: null,
      maxBudgetCents: null,
      files: {},
      skills: [],
    };
    const allow = harnessCommands["claude-code"]("x", null, "git", { profile }).find((a) =>
      a.startsWith("--allowedTools="),
    )!;
    expect(allow).toBe(
      "--allowedTools=Read,Edit,Write,Glob,Grep,Bash(git:*),Bash(gh pr create:*),Bash(python3:*),Bash(bash /tmp/fetch.sh)",
    );
  });
  test("code flags pre-approve commands, files and the web, and keep the prompt last", () => {
    const host = harnessCommands["claude-code"]("do it", null, "git");
    expect(host.at(-1)).toBe("do it");
    expect(host).toContain("acceptEdits");
    expect(host.find((a) => a.startsWith("--allowedTools="))).toBe(
      "--allowedTools=Read,Edit,Write,Glob,Grep,Bash,WebFetch,WebSearch",
    );
    expect(host.find((a) => a.startsWith("--disallowedTools="))).toContain(
      "Bash(git push --force:*)",
    );
    expect(
      harnessCommands["claude-code"]("x", null, "full").find((a) =>
        a.startsWith("--allowedTools="),
      ),
    ).toContain(",Bash");
    expect(harnessCommands["claude-code"]("x", null)).toEqual([
      "claude",
      "-p",
      "--output-format",
      "stream-json",
      "--verbose",
      "--append-system-prompt",
      "Before each group of tool calls, write one short sentence that says what you will do next.",
      "x",
    ]);
    expect(harnessCommands.codex("x", null, "git")).toContain(
      "sandbox_workspace_write.network_access=true",
    );
    expect(harnessCommands.codex("x", null, "full")).toContain(
      "--dangerously-bypass-approvals-and-sandbox",
    );
    expect(harnessCommands.opencode("x", null, "git")).toContain("--auto");
    expect(harnessCommands.hermes("x", null)).toEqual([
      "hermes",
      "--ignore-rules",
      "-t",
      "web",
      "-z",
      "x",
    ]);
    expect(harnessCommands.hermes("x", null, "git")).toContain("web,file");
    expect(harnessCommands.hermes("x", null, "git").join()).not.toContain("terminal");
    expect(harnessCommands.hermes("x", null, "full")).toContain("web,file,terminal,code_execution");
    expect(harnessCommands.codex("x", null)).toEqual([
      "codex",
      "exec",
      "--skip-git-repo-check",
      "x",
    ]);
  });
  test("workspaces are per user and cannot escape the root", () => {
    expect(codeWorkspace("u1", "/data/code")).toBe("/data/code/u1");
    expect(codeWorkspace("../evil", "/data/code")).toBe("/data/code/___evil");
  });
  test("git env carries identity, and the token only through a github.com credential helper", () => {
    const dev = { name: "Dev", email: "dev@example.invalid", mode: "fixed" } as const;
    const plain = gitEnv({ ...dev, name: "Dev <bot>" });
    expect(plain.GIT_AUTHOR_NAME).toBe("Dev  bot");
    expect(plain.GIT_CONFIG_COUNT).toBeUndefined();
    const withToken = gitEnv(dev, { GITHUB_TOKEN: "ghp_secret" });
    expect(withToken.GIT_CONFIG_KEY_0).toBe("credential.https://github.com.helper");
    expect(
      Object.entries(withToken)
        .filter(([k]) => k !== "GH_TOKEN")
        .some(([, v]) => v.includes("ghp_secret")),
    ).toBe(false);
  });
  test("a fixed identity signs author and committer with it, one line each", () => {
    const env = gitEnv({ name: "Ana\nEvil", email: "ana@example.invalid\nX", mode: "fixed" });
    expect(env).toMatchObject({
      GIT_AUTHOR_NAME: "Ana Evil",
      GIT_COMMITTER_NAME: "Ana Evil",
      GIT_AUTHOR_EMAIL: "ana@example.invalidX",
      GIT_COMMITTER_EMAIL: "ana@example.invalidX",
    });
  });
  test("git-config mode leaves the identity to git when it has one, else uses the bot's", () => {
    const who = { name: "Dev", email: "dev@zettabot.app", mode: "git-config" } as const;
    const withGlobal = gitEnv(who, {}, true);
    expect(withGlobal.GIT_AUTHOR_EMAIL).toBeUndefined();
    expect(withGlobal.GIT_COMMITTER_NAME).toBeUndefined();
    expect(gitEnv(who, {}, false).GIT_AUTHOR_EMAIL).toBe("dev@zettabot.app");
    // A fixed identity ignores the global one.
    expect(gitEnv({ ...who, mode: "fixed" }, {}, true).GIT_AUTHOR_EMAIL).toBe("dev@zettabot.app");
  });
  test("the bot address is its name as a lower-case slug", () => {
    expect(botEmail("Code Reviewer")).toBe("code_reviewer@zettabot.app");
    expect(botEmail("Ünïcode Bot!")).toBe("unicode_bot@zettabot.app");
    expect(botEmail("!!!")).toBe("bot@zettabot.app");
  });
  test("gitIdentity needs both a global name and email in the run's home", async () => {
    const both = await mkdtemp(join(tmpdir(), "zetta-home-"));
    await writeFile(
      join(both, ".gitconfig"),
      "[user]\n\tname = Ana\n\temail = ana@example.invalid\n",
    );
    const nameOnly = await mkdtemp(join(tmpdir(), "zetta-home-"));
    await writeFile(join(nameOnly, ".gitconfig"), "[user]\n\tname = Ana\n");
    const none = await mkdtemp(join(tmpdir(), "zetta-home-"));
    expect(await gitIdentity(both)).toBe(true);
    expect(await gitIdentity(nameOnly)).toBe(false);
    expect(await gitIdentity(none)).toBe(false);
  });
  test("gitIdentity is false when git is not installed", async () => {
    expect(await gitIdentity("/nowhere-no-git", () => null)).toBe(false);
  });
  test("with the server's gh login, git asks the gh CLI and no token is set", () => {
    const env = gitEnv(
      { name: "Dev", email: "dev@example.invalid", mode: "fixed" },
      { ZETTA_GITHUB_AUTH: "cli" },
    );
    expect(env.GIT_CONFIG_KEY_0).toBe("credential.https://github.com.helper");
    expect(env.GIT_CONFIG_VALUE_0).toBe("!gh auth git-credential");
    expect(env.GH_TOKEN).toBeUndefined();
    // An account token still wins over the CLI login.
    expect(
      gitEnv(
        { name: "Dev", email: "dev@example.invalid", mode: "fixed" },
        { ZETTA_GITHUB_AUTH: "cli", GITHUB_TOKEN: "ghp_x" },
      ).GH_TOKEN,
    ).toBe("ghp_x");
  });
  test("ghLoggedIn is false when the gh CLI is not installed", async () => {
    expect(await ghLoggedIn("/nowhere-no-gh", () => null)).toBe(false);
  });
  test("the docker command mounts the user's workspace instead of a tmpfs", () => {
    const cfg = { image: "i", network: "bridge", memory: "1g", cpus: "1", pids: 64, bin: "docker" };
    const code = dockerArgs(cfg, {
        name: "n",
        argv: ["claude"],
        workspace: "/data/code/u1",
        env: {},
      }),
      plain = dockerArgs(cfg, { name: "n", argv: ["claude"], env: {} });
    expect(code).toContain("/data/code/u1:/work:rw");
    expect(code.some((a) => a.startsWith("/work:rw"))).toBe(false);
    expect(plain.some((a) => a.startsWith("/work:rw,size="))).toBe(true);
  });
  test("a code run executes in the user's persistent workspace and keeps it", async () => {
    const root = await mkdtemp(join(tmpdir(), "zetta-code-"));
    process.env.ZETTA_CODE_ROOT = root;
    const fake = await script('echo "cwd=$(pwd -P) author=$GIT_AUTHOR_NAME arg=$*"; touch kept');
    const out = await runCli({
      harness: "claude-code",
      prompt: "hi",
      model: null,
      userId: "alice",
      code: { name: "dev", email: "dev@example.invalid", mode: "fixed" },
      resolve: () => fake,
    });
    delete process.env.ZETTA_CODE_ROOT;
    const dir = (await import("node:fs/promises")).realpath(join(root, "alice"));
    expect(out).toContain(`cwd=${await dir}`);
    expect(out).toContain("author=dev");
    expect(out).toContain("--permission-mode acceptEdits");
    expect(await Bun.file(join(root, "alice", "kept")).exists()).toBe(true);
  });
});

import { killGroup } from "./harness";
import { test as osTest, expect as osExpect } from "bun:test";
osTest("killGroup is safe for missing processes on every platform branch", () => {
  osExpect(() => killGroup(2 ** 22 + 12345, "linux")).not.toThrow();
  osExpect(() => killGroup(2 ** 22 + 12345, "win32")).not.toThrow(); // taskkill is absent here; the failure must be swallowed
});
