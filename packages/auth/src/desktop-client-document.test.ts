import { describe, expect, test } from "bun:test";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { validateCimdMetadata } from "@better-auth/cimd";

// The desktop app signs in to a Zetta server as the client whose id is the address of this document (apps/desktop/src/bun/oauth.ts).
// A server accepts the app only if the document passes the same check it runs when the app asks to sign in.
const file = join(import.meta.dir, "../../../apps/landing/public/oauth/zetta-desktop.json");
const document = JSON.parse(readFileSync(file, "utf8")) as Record<string, unknown>;

describe("the desktop app's client document", () => {
  test("passes the server's own validation, for the MCP profile the server runs", () => {
    const result = validateCimdMetadata(String(document.client_id), document, {
      metadataProfile: "mcp-2026-07-28",
    });
    expect(result).toMatchObject({ valid: true });
  });

  test("names the address it is served from as its id, and the loopback address as its only way back", () => {
    expect(document.client_id).toBe("https://zettabot.app/oauth/zetta-desktop.json");
    expect(document.redirect_uris).toEqual(["http://127.0.0.1/callback"]);
    expect(document.token_endpoint_auth_method).toBe("none");
  });

  test("asks for no more than the app uses", () => {
    expect(String(document.scope).split(" ").sort()).toEqual([
      "mcp:read",
      "mcp:write",
      "offline_access",
      "openid",
    ]);
  });

  test("is the client id the app uses by default", () => {
    const source = readFileSync(
      join(import.meta.dir, "../../../apps/desktop/src/bun/oauth.ts"),
      "utf8",
    );
    expect(source).toContain(`DEFAULT_CLIENT_ID = "${document.client_id}"`);
  });
});
