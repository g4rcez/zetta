import { expect, test } from "bun:test";
import { fetchClientMetadataResource } from "@better-auth/cimd/node";

// MCP clients make the server fetch a URL they choose (their client metadata document). The transport is written for Node; these cases
// prove it still refuses local and special-use targets on the Bun version Zetta runs on, without network access.
test.each([
  "https://localhost/client.json",
  "https://127.0.0.1/client.json",
  "https://10.0.0.1/client.json",
  "https://169.254.169.254/latest/meta-data",
])("client metadata fetch refuses %s", async (url) => {
  await expect(fetchClientMetadataResource(url)).rejects.toThrow("public-routable");
});

test("client metadata fetch refuses plain HTTP", async () => {
  await expect(fetchClientMetadataResource("http://example.test/client.json")).rejects.toThrow(
    "HTTPS",
  );
});
