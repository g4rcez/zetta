import { expect, test } from "bun:test";
import { strToU8, zipSync } from "fflate";
import { unzipSkill, zipSkill, ZipError, ZIP_LIMITS } from "./skill-zip";

const fails = (f: () => unknown) => {
  try {
    f();
  } catch (e) {
    return e as Error;
  }
  throw new Error("expected a failure");
};

test("a skill goes into a zip and comes back the same", () => {
  const skill = {
    name: "release-notes",
    description: "Use when: the user asks for release notes",
    body: "1) List PRs.\n2) Group them.",
  };
  const files = [
    {
      path: "scripts/build.sh",
      content: strToU8("#!/bin/sh\necho hi"),
      mode: "executable" as const,
    },
    { path: "assets/logo.bin", content: new Uint8Array([0, 255, 1, 2]), mode: "file" as const },
  ];
  const back = unzipSkill(zipSkill(skill, files));
  expect(back).toMatchObject(skill);
  expect(back.files.map((f) => `${f.path}:${f.mode}`)).toEqual([
    "assets/logo.bin:file",
    "scripts/build.sh:executable",
  ]);
  expect([...back.files[0]!.content]).toEqual([0, 255, 1, 2]);
});

test("SKILL.md may be at the top of the zip or inside its one folder; the folder name is the fallback name", () => {
  const top = unzipSkill(
    zipSync({ "SKILL.md": strToU8("---\ndescription: d\n---\nbody"), "a.txt": strToU8("x") }),
    "my-folder",
  );
  expect(top).toMatchObject({ name: "my-folder", description: "d", body: "body" });
  expect(top.files.map((f) => f.path)).toEqual(["a.txt"]);
  const nested = unzipSkill(
    zipSync({
      "Some Skill/SKILL.md": strToU8("---\ndescription: d\n---\nbody"),
      "Some Skill/x/y.txt": strToU8("x"),
    }),
  );
  expect(nested.name).toBe("some-skill");
  expect(nested.files.map((f) => f.path)).toEqual(["x/y.txt"]);
});

test("macOS and git leftovers are ignored", () => {
  const r = unzipSkill(
    zipSync({
      "s/SKILL.md": strToU8("---\ndescription: d\n---\nb"),
      "s/.DS_Store": strToU8("x"),
      "__MACOSX/s/._SKILL.md": strToU8("x"),
      "s/.git/config": strToU8("x"),
      "s/real.txt": strToU8("x"),
    }),
  );
  expect(r.files.map((f) => f.path)).toEqual(["real.txt"]);
});

test("a zip without SKILL.md, with two, or that is not a zip says so", () => {
  expect(fails(() => unzipSkill(zipSync({ "a.txt": strToU8("x") }))).message).toContain(
    "no SKILL.md",
  );
  expect(
    fails(() => unzipSkill(zipSync({ "a/SKILL.md": strToU8("x"), "b/SKILL.md": strToU8("y") })))
      .message,
  ).toContain("more than one");
  expect(fails(() => unzipSkill(strToU8("not a zip at all")))).toBeInstanceOf(ZipError);
  expect(fails(() => unzipSkill(strToU8("not a zip at all"))).message).toBe(
    "That is not a zip file.",
  );
});

test("limits are enforced before anything is unpacked: too many files, a file over 1 MB, a folder over 4 MB", () => {
  const many: Record<string, Uint8Array> = { "s/SKILL.md": strToU8("---\ndescription: d\n---\nb") };
  for (let i = 0; i < ZIP_LIMITS.count + 1; i++) many[`s/f${i}.txt`] = strToU8("x");
  expect(fails(() => unzipSkill(zipSync(many))).message).toContain("at most 200 files");
  expect(
    fails(() =>
      unzipSkill(
        zipSync({
          "s/SKILL.md": strToU8("---\ndescription: d\n---\nb"),
          "s/big.bin": new Uint8Array(1_000_001),
        }),
      ),
    ).message,
  ).toContain("larger than 1 MB");
  const heavy: Record<string, Uint8Array> = {
    "s/SKILL.md": strToU8("---\ndescription: d\n---\nb"),
  };
  for (let i = 0; i < 5; i++) heavy[`s/p${i}.bin`] = new Uint8Array(900_000);
  expect(fails(() => unzipSkill(zipSync(heavy))).message).toContain("larger than 4 MB");
});

test("a path that leaves the folder is refused", () => {
  const sneaky = zipSync({
    "s/SKILL.md": strToU8("---\ndescription: d\n---\nb"),
    "s/../outside.txt": strToU8("x"),
  });
  expect(fails(() => unzipSkill(sneaky))).toBeInstanceOf(ZipError);
});

test("a description with new lines is kept on one line when exported", () => {
  const back = unzipSkill(
    zipSkill({ name: "multi", description: "line one\nline two", body: "b" }, []),
  );
  expect(back.description).toBe("line one line two");
});
