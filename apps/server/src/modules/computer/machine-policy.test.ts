import { describe, expect, test } from "bun:test";
import { mkdir, mkdtemp, realpath, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { guardedWords, ruleOf, workspacePath } from "./machine-policy";
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
