import { describe, expect, test } from "bun:test";
import { linkParts, parseSetupCard } from "./setup-card-data";

describe("parseSetupCard", () => {
  test("reads a card built by the server", () => {
    expect(
      parseSetupCard('{"plugin":"google","botId":"b1","scope":"team","scopes":["gmail.readonly"]}'),
    ).toEqual({
      plugin: "google",
      botId: "b1",
      scope: "team",
      scopes: ["gmail.readonly"],
    });
  });

  test("drops what is not a text scope", () => {
    expect(
      parseSetupCard('{"plugin":"google","botId":"b1","scope":"mine","scopes":["a",1,null]}')
        ?.scopes,
    ).toEqual(["a"]);
  });

  test("rejects a bad plugin id, a missing bot, a bad scope and broken JSON", () => {
    expect(parseSetupCard('{"plugin":"../x","botId":"b1","scope":"mine"}')).toBeUndefined();
    expect(parseSetupCard('{"plugin":"github","scope":"mine"}')).toBeUndefined();
    expect(parseSetupCard('{"plugin":"github","botId":"b1","scope":"all"}')).toBeUndefined();
    expect(parseSetupCard("{nope")).toBeUndefined();
  });
});

describe("linkParts", () => {
  test("turns a web address into a link and keeps the full stop out of it", () => {
    expect(linkParts("Open https://console.cloud.google.com/ and create a project.")).toEqual([
      { text: "Open " },
      { text: "https://console.cloud.google.com/", href: "https://console.cloud.google.com/" },
      { text: " and create a project." },
    ]);
    expect(linkParts("Go to https://github.com/settings.")).toEqual([
      { text: "Go to " },
      { text: "https://github.com/settings", href: "https://github.com/settings" },
      { text: "." },
    ]);
  });

  test("leaves a step without addresses as one piece of text", () => {
    expect(linkParts("Press Pair.")).toEqual([{ text: "Press Pair." }]);
  });
});
