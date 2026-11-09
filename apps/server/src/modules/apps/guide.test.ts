import { describe, expect, test } from "bun:test";
import { BRIDGE_LIMITS } from "@zetta/core/app-bridge";
import { ARTIFACT_CLASSES } from "../artifacts/design-system";
import { appToolFields, APP_FILE_LIMIT } from "./fields";
import { appGuide } from "./guide";
import { MANIFEST_LIMITS } from "./manifest";
import { STORAGE_LIMITS } from "./storage";

/** The guide is what a bot builds from, so every number and name in it must be the code's own. */
describe("the app guide", () => {
  const g = appGuide();
  test("names the real entry points and the bridge", () => {
    for (const needed of [
      "ui/index.html",
      "index.ts",
      "window.zetta.call",
      "defineApp",
      "ctx.storage.put",
      "DECLINED",
    ])
      expect(g).toContain(needed);
  });
  test("its limits are the server's limits", () => {
    expect(g).toContain(`${BRIDGE_LIMITS.inFlight} calls wait at once`);
    expect(g).toContain(`up to ${STORAGE_LIMITS.opsPerCall} writes`);
    expect(g).toContain("64 KB");
    expect(STORAGE_LIMITS.valueBytes).toBe(64_000);
    expect(g).toContain("1 MB of records");
    expect(STORAGE_LIMITS.snapshotBytes).toBe(1_000_000);
    expect(APP_FILE_LIMIT).toBe(50);
    expect(MANIFEST_LIMITS.collections).toBeGreaterThan(0);
  });
  test("carries the design-system classes", () => {
    expect(g).toContain(ARTIFACT_CLASSES[0]!.split(" ")[0]!);
  });
  test("every action it lists is one the tool accepts", () => {
    for (const action of ["create", "update", "get", "list", "archive"])
      expect(g).toContain(action);
    expect(appToolFields.safeParse({ action: "guide" }).success).toBe(true);
    expect(appToolFields.safeParse({ action: "nope" }).success).toBe(false);
  });
});
