import { describe, expect, test } from "bun:test";
import { existsSync } from "node:fs";
import { mkdir, mkdtemp, readFile, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedWords, ruleOf, stagedTransfer, workspacePath } from "./machine-policy";
import type { ComputerError } from "./service";

const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => "none",
    (e: ComputerError) => e.code,
  );

describe("guardedWords", () => {
  test("names the delete, root and mail commands wherever they are in the line", () => {
    expect(guardedWords("rm -rf /srv/cache")).toEqual(["rm"]);
    expect(guardedWords("cd /srv && rm x; sudo systemctl restart app")).toEqual(["rm", "sudo"]);
    expect(guardedWords("ls | xargs /bin/rm")).toEqual(["rm"]);
    expect(guardedWords("echo $(rmdir old) && unlink a && shred b")).toEqual([
      "rmdir",
      "shred",
      "unlink",
    ]);
    expect(guardedWords("mail -s hi a@example.invalid < msg; /usr/sbin/sendmail -t")).toEqual([
      "mail",
      "sendmail",
    ]);
  });

  test("leaves ordinary commands and look-alike names alone", () => {
    expect(guardedWords("uname -a")).toEqual([]);
    expect(guardedWords("tail -n 50 /var/log/app.log")).toEqual([]);
    expect(guardedWords("cat rm-notes.txt mail.example.invalid.txt format")).toEqual([]);
    expect(guardedWords("git status && npm run build")).toEqual([]);
  });

  test("a rule lifts exactly one command", () => {
    expect(ruleOf("rm")).toBe("Bash(rm:*)");
    expect(ruleOf("sudo")).toBe("Bash(sudo:*)");
  });
});

describe("workspacePath", () => {
  const setup = async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "zws-")));
    const base = join(root, "code");
    await mkdir(join(base, "app"), { recursive: true });
    await writeFile(join(base, "app", "report.txt"), "report");
    await mkdir(join(root, "outside"));
    await writeFile(join(root, "outside", "secret.txt"), "not yours");
    await symlink(join(root, "outside"), join(base, "link"));
    return { root, base };
  };

  test("reads a file inside the workspace, by relative or by absolute path", async () => {
    const { base } = await setup();
    expect(await workspacePath(base, "app/report.txt", "read")).toBe(
      join(base, "app", "report.txt"),
    );
    expect(await workspacePath(base, join(base, "app", "report.txt"), "read")).toBe(
      join(base, "app", "report.txt"),
    );
  });

  test("a download may create folders; an upload of a missing file is NOT_FOUND", async () => {
    const { base } = await setup();
    expect(await workspacePath(base, "downloads/2026/a.txt", "write")).toBe(
      join(base, "downloads", "2026", "a.txt"),
    );
    expect(await codeOf(workspacePath(base, "app/missing.txt", "read"))).toBe("NOT_FOUND");
  });

  test("refuses .., other folders, symlinks that leave the workspace, and credential names", async () => {
    const { root, base } = await setup();
    for (const p of [
      "../outside/secret.txt",
      join(root, "outside", "secret.txt"),
      "/etc/passwd",
      "link/secret.txt",
      ".ssh/id_ed25519",
      "app/.env",
      "key.pem",
      "a\\b",
      "a\nb",
      "",
    ])
      expect(await codeOf(workspacePath(base, p, "read"))).toBe("INVALID");
    expect(await codeOf(workspacePath(base, "link/new.txt", "write"))).toBe("INVALID");
    expect(await codeOf(workspacePath(base, ".ssh/authorized_keys", "write"))).toBe("INVALID");
  });
});

describe.skipIf(process.platform === "win32")("a transfer and a planted link", () => {
  const setup = async () => {
    const root = await realpath(await mkdtemp(join(tmpdir(), "zst-")));
    const base = join(root, "code");
    const outside = join(root, "outside");
    await mkdir(base, { recursive: true });
    await mkdir(outside);
    await writeFile(join(outside, "secret.txt"), "not yours");
    return { root, base, outside };
  };
  const done = { exitCode: 0 };

  test("a link that points at nothing yet is not a place to write", async () => {
    const { base, outside } = await setup();
    await symlink(join(outside, "later"), join(base, "x"));
    expect(await codeOf(workspacePath(base, "x", "write"))).toBe("INVALID");
    await symlink(join(outside, "gone"), join(base, "d"));
    expect(await codeOf(workspacePath(base, "d/file", "write"))).toBe("INVALID");
  });

  test("a download lands in the workspace, not through a link planted while it ran", async () => {
    const { base, outside } = await setup();
    const local = await workspacePath(base, "in/payload", "write");
    await stagedTransfer(base, { type: "get", remote: "payload", local }, async (op) => {
      // The program writes to a folder of the server's own.
      expect(op.local.startsWith(base)).toBe(false);
      await writeFile(op.local, "downloaded");
      await symlink(join(outside, "planted"), local);
      return done;
    });
    expect(await readFile(local, "utf8")).toBe("downloaded");
    expect(existsSync(join(outside, "planted"))).toBe(false);
  });

  test("a failed download leaves nothing", async () => {
    const { base } = await setup();
    const local = await workspacePath(base, "payload", "write");
    await stagedTransfer(base, { type: "get", remote: "payload", local }, async (op) => {
      await writeFile(op.local, "half");
      return { exitCode: 1 };
    });
    expect(existsSync(local)).toBe(false);
  });

  test("an upload sends the file that was checked, under its own name", async () => {
    const { base, outside } = await setup();
    await writeFile(join(base, "report.txt"), "report");
    const local = await workspacePath(base, "report.txt", "read");
    let sent = "";
    await stagedTransfer(base, { type: "put", local, remote: "/tmp/" }, async (op) => {
      expect(op.local.startsWith(base)).toBe(false);
      expect(op.local.endsWith("report.txt")).toBe(true);
      sent = await readFile(op.local, "utf8");
      return done;
    });
    expect(sent).toBe("report");
    await symlink(join(outside, "secret.txt"), join(base, "swapped"));
    expect(
      await codeOf(
        stagedTransfer(
          base,
          { type: "put", local: join(base, "swapped"), remote: "x" },
          async () => done,
        ),
      ),
    ).toBe("NOT_FOUND");
  });
});
