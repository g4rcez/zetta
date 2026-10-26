import { describe, expect, test } from "bun:test";
import { toolPreamble } from "./tools";

describe("toolPreamble", () => {
  test("computer tools are only described when the owner enabled them", () => {
    expect(toolPreamble("off")).not.toContain("zetta:browser");
    expect(toolPreamble()).not.toContain("zetta:desktop");
    expect(toolPreamble("browser")).toContain("zetta:browser");
    expect(toolPreamble("browser")).toContain("zetta:handoff");
    expect(toolPreamble("browser")).not.toContain("zetta:desktop");
    expect(toolPreamble("desktop")).toContain("zetta:desktop");
  });
  test("code access is only described when the owner enabled it", () => {
    expect(toolPreamble("off")).not.toContain("Code access");
    expect(toolPreamble("off", true)).toContain("git clone");
    expect(toolPreamble("browser", true)).toContain("zetta:browser");
    expect(toolPreamble("browser", true)).toContain("Code access");
  });
});
