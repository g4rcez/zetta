import { expect, test } from "bun:test";
import { keyFromHash } from "./install-onboarding";

test("the setup key comes from the address fragment, and only from there", () => {
  expect(keyFromHash("#key=abc%2Fdef%3D")).toBe("abc/def=");
  expect(keyFromHash("key=plain")).toBe("plain");
  expect(keyFromHash("#other=1")).toBe("");
  expect(keyFromHash("")).toBe("");
  expect(keyFromHash("#key=%20%20")).toBe("");
});
