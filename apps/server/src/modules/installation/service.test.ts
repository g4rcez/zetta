import { describe, expect, test } from "bun:test";
import { createInstallationService } from "./service";

/** The database is the only fake: it holds one row, like the real singleton table. */
function fakeDb(row?: Record<string, unknown>) {
  let stored = row;
  return {
    select: () => ({
      from: () => ({ where: () => ({ limit: async () => (stored ? [stored] : []) }) }),
    }),
    insert: () => ({
      values: (v: Record<string, unknown>) => ({
        onConflictDoUpdate: async () => {
          stored = v;
        },
      }),
    }),
  } as never;
}

describe("installation service", () => {
  test("Laya is off when nothing is saved", async () => {
    expect((await createInstallationService(fakeDb()).load()).laya).toBe("off");
  });
  test("turning Laya on is saved and announced once", async () => {
    const seen: string[] = [];
    const service = createInstallationService(fakeDb(), (s) => seen.push(s.laya));
    expect((await service.update({ laya: "on" })).laya).toBe("on");
    expect((await service.load()).laya).toBe("on");
    expect(seen).toEqual(["on"]);
  });
  test("languages: English first, no duplicates, junk dropped", async () => {
    const service = createInstallationService(fakeDb());
    expect((await service.load()).layaLanguages).toEqual(["en"]);
    expect(
      (await service.update({ layaLanguages: ["pt-BR", "en", "pt-BR", "x_y"] })).layaLanguages,
    ).toEqual(["en", "pt-BR"]);
    expect((await service.load()).layaLanguages).toEqual(["en", "pt-BR"]);
  });
  test("a refused update announces nothing", async () => {
    const seen: string[] = [];
    const service = createInstallationService(fakeDb(), (s) => seen.push(s.laya));
    await expect(service.update({ networkMode: "network", laya: "on" })).rejects.toThrow();
    expect(seen).toEqual([]);
  });
});
