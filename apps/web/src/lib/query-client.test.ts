import { afterEach, expect, test } from "bun:test";

import { queryClient } from "./query-client";
import { setLive } from "./query-policy";

afterEach(() => setLive(false));

const onFocus = () => {
  const option = queryClient.getDefaultOptions().queries?.refetchOnWindowFocus;
  return typeof option === "function" ? option({} as never) : option;
};

test("coming back to the window refetches only when the live channel is not open", () => {
  setLive(true);
  expect(onFocus()).toBe(false);
  setLive(false);
  expect(onFocus()).toBe(true);
});
