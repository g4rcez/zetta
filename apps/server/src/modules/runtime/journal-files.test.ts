import { expect, test as bunTest } from "bun:test";
// The journal store needs POSIX uids, modes and paths, so it is not run on Windows.
const test = process.platform === "win32" ? bunTest.skip : bunTest;
import {
  chmod,
  link,
  mkdir,
  mkdtemp,
  readFile,
  readdir,
  rm,
  symlink,
  writeFile,
} from "node:fs/promises";
import { join, resolve } from "node:path";
import { createFixtureLaunchPolicy, expandFixtureRecipe } from "./launch-recipe";
import { createLaunchJournal } from "./launch-journal";
import { parseLaunchSpec } from "./launch-spec";
import { encodeJournal } from "./journal-codec";
import { openJournalFiles, readJournalSnapshot } from "./journal-files";
import type { JournalFileFaults, JournalFileStage } from "./journal-files";

function codecFixture() {
  const policy = createFixtureLaunchPolicy({
    installationId: "fixture",
    policyVersion: "fixture",
    image: `sha256:${"1".repeat(64)}`,
  });
  const admission = {
    nowEpochMs: 1000,
    authorizedDeadlineEpochMs: 61000,
    policyVersion: "fixture",
  };
  const spec = parseLaunchSpec(
    {
      version: 1,
      context: {
        actorId: "a",
        runId: "r",
        attemptId: "t",
        botId: "b",
        conversationId: "c",
        configurationId: "f",
      },
      leaseId: "l",
      fence: 1,
      recipe: "fixture-v1",
      fixtureCase: "echo",
      policyVersion: "fixture",
      deadlineEpochMs: 61000,
      budgets: {
        deadlineMs: 60000,
        maxInputBytes: 65536,
        maxOutputBytes: 65536,
        maxFrameBytes: 8192,
      },
    },
    admission,
  );
  const record = createLaunchJournal(expandFixtureRecipe(spec, policy), admission);
  return { record, trusted: { policy, receiptId: record.receiptId } };
}

async function fixture(
  run: (
    value: ReturnType<typeof codecFixture> & {
      root: string;
      directory: string;
      unrelated: string;
      uid: number;
    },
  ) => Promise<void>,
) {
  const root = await mkdtemp(join(resolve("."), ".journal-008d1-"));
  await chmod(root, 0o700);
  const value = codecFixture(),
    directory = join(root, value.record.receiptId),
    unrelated = join(root, "unrelated");
  await mkdir(directory, { mode: 0o700 });
  await writeFile(unrelated, "unrelated synthetic bytes", { mode: 0o600 });
  const uid = process.getuid?.();
  if (uid === undefined) throw new Error("uid unavailable");
  try {
    await run({ ...value, root, directory, unrelated, uid });
  } finally {
    expect(await readFile(unrelated, "utf8")).toBe("unrelated synthetic bytes");
    await rm(root, { recursive: true });
    expect((await readdir(resolve("."))).includes(root.split("/").at(-1) ?? "")).toBe(false);
    console.info(
      JSON.stringify({
        fixture: root,
        platform: process.platform,
        bun: Bun.version,
        cleanup: "exact_absent",
        unrelated: "preserved",
      }),
    );
  }
}

test("actual protected file insertion/replacement/readback keeps unrelated bytes and exact cleanup", async () =>
  fixture(async (f) => {
    const files = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted });
    try {
      await files.commit(null, f.record);
      expect(await files.read()).toEqual(f.record);
      const next = { ...f.record, observedAtEpochMs: 1001 };
      await files.commit(f.record, next);
      expect(await readFile(join(f.directory, "record.json"))).toEqual(
        encodeJournal(next, f.trusted),
      );
      await expect(files.commit(f.record, next)).rejects.toThrow("journal_conflict");
      expect(await readdir(f.directory)).toEqual(["record.json"]);
    } finally {
      await files.close();
    }
  }));

for (const kind of ["symlink", "hardlink", "mode", "corrupt", "oversize"])
  test(`rejects actual ${kind} without adoption`, async () =>
    fixture(async (f) => {
      const path = join(f.directory, "record.json");
      if (kind === "symlink") await symlink(f.unrelated, path);
      else if (kind === "hardlink") await link(f.unrelated, path);
      else
        await writeFile(
          path,
          kind === "corrupt"
            ? Buffer.from([0xff])
            : kind === "oversize"
              ? Buffer.alloc(16385)
              : encodeJournal(f.record, f.trusted),
          { mode: kind === "mode" ? 0o644 : 0o600 },
        );
      const files = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted });
      try {
        await expect(files.read()).rejects.toThrow();
        await expect(
          readJournalSnapshot({ root: f.root, uid: f.uid, ...f.trusted }),
        ).rejects.toThrow();
      } finally {
        await files.close();
      }
    }));

test("existing staging is retained and initial record cannot overwrite existing content", async () =>
  fixture(async (f) => {
    const files = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted });
    try {
      await writeFile(join(f.directory, "record.next"), "partial", { mode: 0o600 });
      await expect(files.commit(null, f.record)).rejects.toThrow("journal_recovery_required");
      expect(await readFile(join(f.directory, "record.next"), "utf8")).toBe("partial");
    } finally {
      await files.close();
    }
  }));

for (const stage of [
  "create",
  "write",
  "file_sync",
  "file_close",
  "rename",
  "directory_sync",
  "readback",
] satisfies JournalFileStage[]) {
  test(`post-mutation ${stage} rejection is private, uncertain and sticky`, async () =>
    fixture(async (f) => {
      const faults: JournalFileFaults = {
        after: async (current) => {
          if (current === stage) throw new Error("synthetic private syscall detail");
        },
      };
      const files = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted }, faults);
      try {
        await expect(files.commit(null, f.record)).rejects.toThrow("journal_durability_unknown");
        await expect(files.commit(null, f.record)).rejects.toThrow("journal_durability_unknown");
        expect((await readdir(f.directory)).length).toBe(1);
      } finally {
        await files.close();
      }
    }));
}

test("partial writes complete and zero writes poison without promotion", async () =>
  fixture(async (f) => {
    let calls = 0;
    const files = await openJournalFiles(
      { root: f.root, uid: f.uid, ...f.trusted },
      {
        write: async (handle, bytes, offset) => {
          calls++;
          return (await handle.write(bytes, offset, Math.min(7, bytes.length - offset), offset))
            .bytesWritten;
        },
      },
    );
    try {
      await files.commit(null, f.record);
      expect(calls).toBeGreaterThan(1);
    } finally {
      await files.close();
    }
    const failed = await openJournalFiles(
      { root: f.root, uid: f.uid, ...f.trusted },
      { write: async () => 0 },
    );
    try {
      await expect(
        failed.commit(f.record, { ...f.record, observedAtEpochMs: 1001 }),
      ).rejects.toThrow("journal_durability_unknown");
      expect(await readFile(join(f.directory, "record.json"))).toEqual(
        encodeJournal(f.record, f.trusted),
      );
      expect(await readFile(join(f.directory, "record.next"))).toHaveLength(0);
    } finally {
      await failed.close();
    }
  }));

for (const stage of [
  "write",
  "file_sync",
  "file_close",
  "rename",
  "directory_sync",
  "readback",
] satisfies JournalFileStage[]) {
  test(`injected failure before ${stage} is uncertain without automatic repair`, async () =>
    fixture(async (f) => {
      const files = await openJournalFiles(
        { root: f.root, uid: f.uid, ...f.trusted },
        {
          before: async (current) => {
            if (current === stage) throw new Error("synthetic EIO");
          },
        },
      );
      try {
        await expect(files.commit(null, f.record)).rejects.toThrow("journal_durability_unknown");
        await expect(files.read()).rejects.toThrow("journal_durability_unknown");
        expect(await readdir(f.directory)).toHaveLength(1);
      } finally {
        await files.close();
      }
    }));
}

test("fixed errors suppress syscall details and expose only closed stage metadata", async () =>
  fixture(async (f) => {
    const files = await openJournalFiles(
      { root: f.root, uid: f.uid, ...f.trusted },
      {
        before: async (stage) => {
          if (stage === "file_sync") throw new Error(f.unrelated);
        },
      },
    );
    try {
      let caught: unknown;
      try {
        await files.commit(null, f.record);
      } catch (error) {
        caught = error;
      }
      expect(caught).toBeInstanceOf(Error);
      if (!(caught instanceof Error)) throw new Error("missing fixed error");
      expect(caught.message).toBe("journal_durability_unknown");
      expect(JSON.stringify(caught)).not.toContain(f.root);
      expect("cause" in caught).toBe(false);
    } finally {
      await files.close();
    }
  }));

test("readback mismatch after a real rename is unknown and never restores the previous file", async () =>
  fixture(async (f) => {
    const files = await openJournalFiles(
      { root: f.root, uid: f.uid, ...f.trusted },
      {
        before: async (stage) => {
          if (stage === "readback")
            await writeFile(join(f.directory, "record.json"), "corrupt", { mode: 0o600 });
        },
      },
    );
    try {
      await expect(files.commit(null, f.record)).rejects.toThrow("journal_durability_unknown");
      expect(await readFile(join(f.directory, "record.json"), "utf8")).toBe("corrupt");
    } finally {
      await files.close();
    }
  }));

test("rejects writable root, foreign UID, noncanonical root, traversal receipt and symbolic receipt", async () =>
  fixture(async (f) => {
    const options = { root: f.root, uid: f.uid, ...f.trusted };
    await expect(openJournalFiles({ ...options, uid: f.uid + 1 })).rejects.toThrow(
      "journal_invalid_files",
    );
    await expect(openJournalFiles({ ...options, root: f.root + "/../" })).rejects.toThrow(
      "journal_invalid_files",
    );
    await expect(openJournalFiles({ ...options, receiptId: "../unrelated" })).rejects.toThrow(
      "journal_invalid_files",
    );
    await chmod(f.root, 0o777);
    await expect(openJournalFiles(options)).rejects.toThrow("journal_invalid_files");
    await chmod(f.root, 0o700);
    await rm(f.directory, { recursive: true });
    await symlink(f.root, f.directory);
    await expect(openJournalFiles(options)).rejects.toThrow("journal_invalid_files");
  }));

test("rejects a writable ancestor and symbolic root without fixing permissions or following it", async () =>
  fixture(async (f) => {
    const nested = join(f.root, "nested");
    await mkdir(nested, { mode: 0o700 });
    await mkdir(join(nested, f.record.receiptId), { mode: 0o700 });
    await chmod(f.root, 0o777);
    await expect(openJournalFiles({ root: nested, uid: f.uid, ...f.trusted })).rejects.toThrow(
      "journal_invalid_files",
    );
    await chmod(f.root, 0o700);
    const alias = join(f.root, "alias");
    await symlink(nested, alias);
    await expect(openJournalFiles({ root: alias, uid: f.uid, ...f.trusted })).rejects.toThrow(
      "journal_invalid_files",
    );
  }));

test("actual FIFO open is nonblocking and rejected before reading", async () =>
  fixture(async (f) => {
    const child = Bun.spawnSync(
      ["/usr/bin/mkfifo", "-m", "600", join(f.directory, "record.json")],
      { stdout: "ignore", stderr: "pipe", timeout: 2000 },
    );
    expect(child.exitCode).toBe(0);
    const files = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted });
    try {
      await expect(files.read()).rejects.toThrow("journal_invalid_files");
    } finally {
      await files.close();
    }
  }));

test("busy primitive refuses close or a second operation until pending I/O settles", async () =>
  fixture(async (f) => {
    let release: () => void = () => {
      throw new Error("not held");
    };
    let signal: () => void = () => {
      throw new Error("not ready");
    };
    const held = new Promise<void>((resolve) => {
      release = resolve;
    });
    const entered = new Promise<void>((resolve) => {
      signal = resolve;
    });
    const files = await openJournalFiles(
      { root: f.root, uid: f.uid, ...f.trusted },
      {
        before: async (stage) => {
          if (stage === "file_sync") {
            signal();
            await held;
          }
        },
      },
    );
    const pending = files.commit(null, f.record);
    try {
      await entered;
      await expect(files.close()).rejects.toThrow("journal_conflict");
      await expect(files.commit(null, f.record)).rejects.toThrow("journal_conflict");
    } finally {
      release();
      await pending;
      await files.close();
    }
  }));

test("record replacement identity changes are rejected and new initial insertion never overwrites", async () =>
  fixture(async (f) => {
    const files = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted });
    try {
      await files.commit(null, f.record);
      await expect(files.commit(null, f.record)).rejects.toThrow("journal_conflict");
      await chmod(f.directory, 0o750);
      await expect(
        files.commit(f.record, { ...f.record, observedAtEpochMs: 1001 }),
      ).rejects.toThrow("journal_invalid_files");
      expect(await readFile(join(f.directory, "record.json"))).toEqual(
        encodeJournal(f.record, f.trusted),
      );
    } finally {
      await files.close();
    }
  }));

test("busy snapshot observes canonical committed bytes with staging and has no write authority", async () =>
  fixture(async (f) => {
    const files = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted });
    try {
      await files.commit(null, f.record);
    } finally {
      await files.close();
    }
    await writeFile(join(f.directory, "record.next"), "partial", { mode: 0o600 });
    const observed = await readJournalSnapshot({ root: f.root, uid: f.uid, ...f.trusted });
    expect(observed).toEqual(f.record);
    expect(Object.isFrozen(observed)).toBe(true);
    expect("commit" in observed).toBe(false);
    expect(await readFile(join(f.directory, "record.next"), "utf8")).toBe("partial");
    await writeFile(join(f.directory, "record.json"), "invalid", { mode: 0o600 });
    await expect(readJournalSnapshot({ root: f.root, uid: f.uid, ...f.trusted })).rejects.toThrow(
      "journal_invalid_files",
    );
  }));

test("snapshot during a held real writer sees committed old then complete new bytes", async () =>
  fixture(async (f) => {
    const initial = await openJournalFiles({ root: f.root, uid: f.uid, ...f.trusted });
    try {
      await initial.commit(null, f.record);
    } finally {
      await initial.close();
    }
    const entered = Promise.withResolvers<void>(),
      release = Promise.withResolvers<void>();
    const writer = await openJournalFiles(
      { root: f.root, uid: f.uid, ...f.trusted },
      {
        before: async (stage) => {
          if (stage === "rename") {
            entered.resolve();
            await release.promise;
          }
        },
      },
    );
    const next = { ...f.record, observedAtEpochMs: 1002 },
      pending = writer.commit(f.record, next);
    try {
      await entered.promise;
      expect(await readJournalSnapshot({ root: f.root, uid: f.uid, ...f.trusted })).toEqual(
        f.record,
      );
    } finally {
      release.resolve();
      await pending;
      await writer.close();
    }
    expect(await readJournalSnapshot({ root: f.root, uid: f.uid, ...f.trusted })).toEqual(next);
  }));
