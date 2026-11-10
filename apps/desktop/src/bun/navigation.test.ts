import { describe, expect, test } from "bun:test";

import { decideNavigation } from "./navigation";

const inside = ["https://zetta.example.invalid", "https://api.example.invalid"];

describe("decideNavigation", () => {
  test("keeps the server's own pages inside", () => {
    expect(decideNavigation("https://zetta.example.invalid/chat/1?x=2#y", inside)).toBe("inside");
    expect(decideNavigation("https://api.example.invalid/api/artifacts/1", inside)).toBe("inside");
    expect(decideNavigation("about:blank", inside)).toBe("inside");
  });

  test("sends other sites to the system browser", () => {
    expect(decideNavigation("https://example.org/", inside)).toBe("external");
    expect(decideNavigation("http://zetta.example.invalid/", inside)).toBe("external"); // another scheme is another origin
    expect(decideNavigation("https://zetta.example.invalid.evil.invalid/", inside)).toBe(
      "external",
    );
    expect(decideNavigation("mailto:a@example.invalid", inside)).toBe("external");
  });

  test("opens nothing for schemes that could reach the app or the disk", () => {
    for (const url of [
      "javascript:alert(1)",
      "file:///etc/passwd",
      "views://launcher/index.html",
      "data:text/html,x",
      "blob:https://zetta.example.invalid/1",
      "zetta://open",
      "not a url",
      "",
    ]) {
      expect(decideNavigation(url, inside)).toBe("block");
    }
  });
});
