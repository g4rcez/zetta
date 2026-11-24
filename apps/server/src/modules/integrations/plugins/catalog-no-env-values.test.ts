import { expect, test } from "bun:test";

import { DEFAULT_WAHA_URL } from "@zetta/core/waha";

import "../mcp"; // importing registers every built-in plugin
import { listPlugins, pluginMeta } from "./registry";

// The catalog is an API answer. varlock scans every answer for the values of the server's `.env` and refuses it when one appears: the
// address of the WhatsApp server is one a person's `.env` may still hold, so the catalog must never carry it (it broke the plugin list).
test("the plugin catalog does not carry the built-in WhatsApp server address", () => {
  const json = JSON.stringify(listPlugins().map(pluginMeta));
  expect(json).not.toContain(DEFAULT_WAHA_URL);
  expect(json).not.toContain("127.0.0.1:3010");
});
