import { describe, expect, it } from "bun:test";

import { isSignedInRoute, wantsShell } from "./shell-routes";

const root = { routeId: "__root__" };
const auth = { routeId: "/_auth" };

describe("app shell routes", () => {
  it("draws the shell on every signed-in page, with no list of paths", () => {
    for (const leaf of [
      "/_auth/catch-up",
      "/_auth/memory-add",
      "/_auth/wiki/$slug",
      "/_auth/anything-new",
    ]) {
      expect(wantsShell([root, auth, { routeId: leaf }])).toBe(true);
    }
  });

  it("leaves public pages without it", () => {
    for (const leaf of ["/", "/login", "/onboarding", "/pair", "/oauth/consent"]) {
      const matches = [root, { routeId: leaf }];
      expect(isSignedInRoute(matches)).toBe(false);
      expect(wantsShell(matches)).toBe(false);
    }
  });

  it("lets a signed-in route opt out with staticData.shell = false", () => {
    const matches = [
      root,
      auth,
      { routeId: "/_auth/computer/$vmId", staticData: { shell: false } },
    ];
    expect(isSignedInRoute(matches)).toBe(true);
    expect(wantsShell(matches)).toBe(false);
  });
});
