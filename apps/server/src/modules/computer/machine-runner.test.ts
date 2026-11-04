import { describe, expect, test } from "bun:test";
import { mkdtemp, readFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  createMachineRunner,
  curlArgs,
  ftpConfig,
  ftpUrl,
  redactSecrets,
  sftpBatch,
  sftpWord,
  type Exit,
  type Spawn,
  type Target,
} from "./machine-runner";
import { ComputerError } from "./service";

// Fake secrets only. The key is not a real key: the runner treats it as an opaque string.
const KEY = [
  "-----BEGIN OPENSSH PRIVATE KEY-----",
  "b3BlbnNzaC1rZXktdjEAAAAABG5vbmUAAAAEbm9uZQAAAAAAAAABAAAAMwAAAAtzc2gtZW",
  "QyNTUxOQAAACDfakefakefakefakefakefakefakefakefakefakefakefakeAAAAB",
  "-----END OPENSSH PRIVATE KEY-----",
].join("\n");
const PASSWORD = "hunter2-fake-pw";
const HOST_KEY = "ssh-ed25519 AAAAC3NzaC1lZDI1NTE5AAAAIATuBV2ktuq3oFQO73FGrq92TshlkGHPmbljpoDTEOZT";
// Both fingerprints come from `ssh-keygen -lf`, not from the code under test.
const HOST_KEY_FINGERPRINT = "SHA256:vrHPOFcz7mGR1uHRp0PH82dQOQY9pq+2GaWfhttdTeA";
const RSA_KEY =
  "ssh-rsa AAAAB3NzaC1yc2EAAAADAQABAAABAQCd+b7OUdN4jGsRI9ZjF8y3WasSanz31dTzY7NMEemKQc5s1s0Z2SqMFOV7IxE8vuzHPA36NAO78p7L3W0ch6Gc8VECr07VuZijQexnD6gpy/IKDTKX0qZ/Y2ftHMijaa9silFBfsjxMWGTD0q+R9H9yzX5+MDhL855sPKLEXDCrW02BZ9vH5QYkgoqlXsHnGIxo6RwU1kXXTt5ej4i9kwFhQIvpFnvisvk71vZOG7Zjb3m5YJqkAjw+hU9XZZx3Za4N4rwUWGJjG7Ggale5MZtzxdlgQScS9MfAeWVs6NgjBPTIk2uTvjRJh7hb6LrGWj1Ghd9TPc1r/0bMF7aZLFB";
const RSA_FINGERPRINT = "SHA256:u2/NBjJMcJ8EN4lfmfvIPNRc6WrNkkY97p7Y6STJNBs";

const ssh: Target = {
  kind: "ssh",
  host: "box.example.invalid",
  ip: "203.0.113.7",
  port: 2222,
  username: "deploy",
  hostKey: HOST_KEY,
};
const ftp: Target = { ...ssh, kind: "ftp", port: 21, username: "bob", hostKey: null };

const done = (o: Partial<Exit> = {}): Exit => ({
  code: 0,
  stdout: "",
  stderr: "",
  truncated: false,
  timedOut: false,
  ...o,
});

type Call = { cmd: string; args: string[]; stdin?: string; env: Record<string, string> };
function fake(reply: (c: Call) => Exit | Promise<Exit>) {
  const calls: Call[] = [];
  const spawn: Spawn = async (cmd, args, o) => {
    const c = { cmd, args, stdin: o.stdin, env: o.env };
    calls.push(c);
    return reply(c);
  };
  return { calls, spawn };
}
/** An agent that records what it was given and never starts a process. */
function agents() {
  const started: { key: string; lifetime: number; dir: string }[] = [];
  let stopped = 0;
  return {
    started,
    stopped: () => stopped,
    startAgent: async (dir: string, key: string, lifetime: number) => {
      started.push({ key, lifetime, dir });
      return {
        sock: join(dir, "a"),
        stop: async () => {
          stopped++;
        },
      };
    },
  };
}
const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => "none",
    (e: ComputerError) => e.code,
  );

describe("redactSecrets", () => {
  test("masks the whole secret and each line of a key", () => {
    const out = redactSecrets(
      `cat gave: ${KEY}\nline: QyNTUxOQAAACDfakefakefakefakefakefakefakefakefakefakefakefakeAAAAB`,
      [KEY],
    );
    expect(out).not.toContain("b3BlbnNzaC1rZXktdjEAAAAA");
    expect(out).not.toContain("fakefakefake");
    expect(out).toContain("[redacted]");
  });

  test("masks a password and leaves other text alone", () => {
    expect(redactSecrets("login hunter2-fake-pw ok", [PASSWORD])).toBe("login [redacted] ok");
  });
});

describe("ssh run", () => {
  test("key goes to the agent, never to argv, env or the command's stdin; host key is pinned", async () => {
    const a = agents();
    const tmp = await mkdtemp(join(tmpdir(), "zsh-test-"));
    let knownHosts = "";
    const f = fake(async () => {
      knownHosts = await readFile(join(tmp, "known_hosts"), "utf8");
      return done({ stdout: "Linux box 6.1\n" });
    });
    const r = createMachineRunner({
      spawn: f.spawn,
      startAgent: a.startAgent,
      tmp: async () => tmp,
    });
    const res = await r.exec(ssh, KEY, { type: "run", command: "uname -a" });

    expect(res).toEqual({ exitCode: 0, output: "Linux box 6.1", truncated: false });
    expect(a.started).toHaveLength(1);
    expect(a.started[0]!.key).toBe(`${KEY}\n`);
    expect(a.started[0]!.lifetime).toBe(600);
    expect(a.stopped()).toBe(1);
    expect(knownHosts).toBe(`zetta-machine ${HOST_KEY}\n`);

    const c = f.calls[0]!;
    expect(c.cmd).toBe("ssh");
    expect(c.args.slice(-5)).toEqual(["-p", "2222", "203.0.113.7", "--", "uname -a"]);
    expect(c.args).toContain("StrictHostKeyChecking=yes");
    expect(c.args).toContain("PasswordAuthentication=no");
    expect(c.args).toContain("ForwardAgent=no");
    expect(c.args).toContain("User=deploy");
    expect(JSON.stringify(c)).not.toContain("fakefakefake");
    expect(c.stdin).toBeUndefined();
    expect(Object.keys(c.env).sort()).toEqual(["LANG", "PATH", "SSH_AUTH_SOCK"]);
  });

  test("a key in the remote output is replaced before it returns", async () => {
    const f = fake(() => done({ stdout: `${KEY}\n`, stderr: `warn ${PASSWORD}` }));
    const r = createMachineRunner({ spawn: f.spawn, startAgent: agents().startAgent });
    const res = await r.exec(ssh, KEY, { type: "run", command: "cat /srv/key" });
    expect(res.output).not.toContain("fakefakefake");
    expect(res.output).toContain("[redacted]");
  });

  test("the remote command's own exit code comes back as a result, not an error", async () => {
    const f = fake(() => done({ code: 2, stdout: "", stderr: "ls: cannot access 'x'" }));
    const r = createMachineRunner({ spawn: f.spawn, startAgent: agents().startAgent });
    expect(await r.exec(ssh, KEY, { type: "run", command: "ls x" })).toEqual({
      exitCode: 2,
      output: "[stderr]\nls: cannot access 'x'",
      truncated: false,
    });
  });

  test("a changed host key, a refused key and a dead host each have their own error", async () => {
    const run = (stderr: string, code = 255) =>
      codeOf(
        createMachineRunner({
          spawn: fake(() => done({ code, stderr })).spawn,
          startAgent: agents().startAgent,
        }).exec(ssh, KEY, { type: "run", command: "id" }),
      );
    expect(await run("Host key verification failed.")).toBe("HOST_KEY_CHANGED");
    expect(await run("deploy@203.0.113.7: Permission denied (publickey).")).toBe("AUTH_FAILED");
    expect(await run("ssh: connect to host 203.0.113.7 port 2222: Connection refused")).toBe(
      "UNREACHABLE",
    );
  });

  test("a timeout is SLOW and the agent is still stopped", async () => {
    const a = agents();
    const r = createMachineRunner({
      spawn: fake(() => done({ code: null, timedOut: true })).spawn,
      startAgent: a.startAgent,
    });
    expect(await codeOf(r.exec(ssh, KEY, { type: "run", command: "sleep 999" }))).toBe("SLOW");
    expect(a.stopped()).toBe(1);
  });

  test("an ssh machine without a pinned key, or a user name that looks like an option, is refused before any process starts", async () => {
    const a = agents();
    const f = fake(() => done());
    const r = createMachineRunner({ spawn: f.spawn, startAgent: a.startAgent });
    expect(
      await codeOf(r.exec({ ...ssh, hostKey: null }, KEY, { type: "run", command: "id" })),
    ).toBe("INVALID");
    expect(
      await codeOf(
        r.exec({ ...ssh, username: "-oProxyCommand=x" }, KEY, { type: "run", command: "id" }),
      ),
    ).toBe("INVALID");
    expect(f.calls).toHaveLength(0);
    expect(a.started).toHaveLength(0);
  });

  test("an sftp machine cannot run commands", async () => {
    const r = createMachineRunner({
      spawn: fake(() => done()).spawn,
      startAgent: agents().startAgent,
    });
    expect(
      await codeOf(r.exec({ ...ssh, kind: "sftp" }, KEY, { type: "run", command: "id" })),
    ).toBe("UNSUPPORTED");
  });
});

describe("sftp batch", () => {
  test("quotes paths and cannot be turned into a second command or an option", () => {
    expect(sftpWord('/srv/my "file".txt')).toBe('"/srv/my \\"file\\".txt"');
    expect(sftpWord("-rf")).toBe('"./-rf"');
    expect(() => sftpWord("a\nrm b")).toThrow();
    expect(sftpBatch({ type: "get", remote: "/srv/a b", local: "/work/a" })).toBe(
      'get "/srv/a b" "/work/a"\n',
    );
    expect(sftpBatch({ type: "put", local: "/work/a", remote: "up/a" })).toBe(
      'put "/work/a" "up/a"\n',
    );
    expect(sftpBatch({ type: "list", path: "." })).toBe('ls -l "."\n');
  });

  test("ssh machine list uses sftp with the batch on stdin and the port as -P", async () => {
    const f = fake(() => done({ stdout: "sftp> ls -l\n-rw-r--r-- 1 deploy deploy 4 a.txt\n" }));
    const r = createMachineRunner({ spawn: f.spawn, startAgent: agents().startAgent });
    await r.exec(ssh, KEY, { type: "list", path: "/srv" });
    const c = f.calls[0]!;
    expect(c.cmd).toBe("sftp");
    expect(c.stdin).toBe('ls -l "/srv"\n');
    expect(c.args.slice(-5)).toEqual(["-P", "2222", "-b", "-", "203.0.113.7"]);
  });
});

describe("ftp", () => {
  test("user and password are only in the curl config on stdin", async () => {
    const f = fake(() => done({ stdout: "drwxr-xr-x 2 ftp ftp 4096 pub\n" }));
    const r = createMachineRunner({ spawn: f.spawn });
    const res = await r.exec(ftp, PASSWORD, { type: "list", path: "/pub" });
    expect(res.output).toBe("drwxr-xr-x 2 ftp ftp 4096 pub");
    const c = f.calls[0]!;
    expect(c.cmd).toBe("curl");
    expect(JSON.stringify(c.args)).not.toContain(PASSWORD);
    expect(JSON.stringify(c.args)).not.toContain("bob");
    expect(c.stdin).toBe(
      [
        'user = "bob:hunter2-fake-pw"',
        'url = "ftp://box.example.invalid:21/%2Fpub/"',
        'connect-to = "box.example.invalid:21:203.0.113.7:21"',
        "",
      ].join("\n"),
    );
  });

  test("curl never reads a user config, ignores the server's PASV address, and only speaks ftp or ftps", () => {
    const args = curlArgs({ type: "list", path: "." });
    expect(args[0]).toBe("-q");
    expect(args).toContain("--ftp-skip-pasv-ip");
    expect(args.slice(args.indexOf("--proto"), args.indexOf("--proto") + 2)).toEqual([
      "--proto",
      "=ftp,ftps",
    ]);
    expect(args.slice(-2)).toEqual(["-K", "-"]);
  });

  test("urls, quoting and transfers", () => {
    expect(ftpUrl("h.example.invalid", 2121, "docs/a b.txt")).toBe(
      "ftp://h.example.invalid:2121/docs/a%20b.txt",
    );
    expect(ftpUrl("2001:db8::1", 21, "x")).toBe("ftp://[2001:db8::1]:21/x");
    expect(
      ftpConfig(ftp, 'p"w\\d', { type: "put", local: "/work/a.txt", remote: "in/a.txt" }),
    ).toContain('user = "bob:p\\"w\\\\d"');
    expect(
      ftpConfig(ftp, PASSWORD, { type: "get", remote: "a.txt", local: "/work/a.txt" }),
    ).toContain('output = "/work/a.txt"');
    expect(() => ftpConfig(ftp, "bad\npassword", { type: "list", path: "." })).toThrow();
  });

  test("ftp cannot run a command; a refused login is AUTH_FAILED", async () => {
    const r = createMachineRunner({
      spawn: fake(() => done({ code: 67, stderr: "curl: (67) Access denied" })).spawn,
    });
    expect(await codeOf(r.exec(ftp, PASSWORD, { type: "run", command: "id" }))).toBe("UNSUPPORTED");
    expect(await codeOf(r.exec(ftp, PASSWORD, { type: "list", path: "." }))).toBe("AUTH_FAILED");
  });

  test("a download says so and does not echo anything the server sent", async () => {
    const r = createMachineRunner({ spawn: fake(() => done()).spawn });
    expect(
      (await r.exec(ftp, PASSWORD, { type: "get", remote: "a", local: "/work/a" })).output,
    ).toBe("Downloaded.");
  });
});

describe("scan and public key", () => {
  test("scan lists each key type once with its SHA256 fingerprint", async () => {
    const f = fake(() =>
      done({
        stdout: `# 203.0.113.7:2222 SSH-2.0-OpenSSH_9.6\n[203.0.113.7]:2222 ${HOST_KEY}\n[203.0.113.7]:2222 ${RSA_KEY}\n[203.0.113.7]:2222 ${RSA_KEY}\n`,
      }),
    );
    expect(await createMachineRunner({ spawn: f.spawn }).scan("203.0.113.7", 2222)).toEqual([
      { type: "ssh-ed25519", key: HOST_KEY, fingerprint: HOST_KEY_FINGERPRINT },
      { type: "ssh-rsa", key: RSA_KEY, fingerprint: RSA_FINGERPRINT },
    ]);
  });

  test("a machine that offers no key is unreachable", async () => {
    const r = createMachineRunner({ spawn: fake(() => done({ stdout: "" })).spawn });
    expect(await codeOf(r.scan("203.0.113.7", 22))).toBe("UNREACHABLE");
  });

  test("the public key is read through the agent and has no comment", async () => {
    const a = agents();
    const f = fake(() => done({ stdout: `${HOST_KEY} (stdin)\n` }));
    const r = createMachineRunner({ spawn: f.spawn, startAgent: a.startAgent });
    expect(await r.publicKey(KEY)).toBe(HOST_KEY);
    expect(f.calls[0]!.cmd + " " + f.calls[0]!.args.join(" ")).toBe("ssh-add -L");
    expect(a.stopped()).toBe(1);
  });

  test("a key the agent cannot load (for example one with a passphrase) is INVALID", async () => {
    const r = createMachineRunner({
      spawn: fake(() => done()).spawn,
      startAgent: async () => {
        throw new ComputerError("INVALID");
      },
    });
    expect(await codeOf(r.publicKey(KEY))).toBe("INVALID");
  });
});
