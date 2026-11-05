import { expect, test } from "bun:test";
import { describeDevice } from "./device";

test.each([
  [
    "Mozilla/5.0 (Macintosh; Intel Mac OS X 10.15; rv:130.0) Gecko/20100101 Firefox/130.0",
    "Firefox on macOS",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36",
    "Chrome on Windows",
  ],
  [
    "Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Safari/537.36 Edg/129.0.0.0",
    "Edge on Windows",
  ],
  [
    "Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1",
    "Safari on iOS",
  ],
  [
    "Mozilla/5.0 (Linux; Android 14; Pixel 8) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/129.0.0.0 Mobile Safari/537.36",
    "Chrome on Android",
  ],
])("%s", (ua, label) => {
  expect(describeDevice(ua)).toBe(label);
});

test("an unknown or missing agent is an unknown device", () => {
  expect(describeDevice(null)).toBe("Unknown device");
  expect(describeDevice("curl/8.7.1")).toBe("Unknown device");
});

test("a system without a known browser still says what it is", () => {
  expect(describeDevice("MyApp/1.0 (Linux)")).toBe("Linux");
});
