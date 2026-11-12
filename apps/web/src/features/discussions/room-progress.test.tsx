import { describe, expect, test } from "bun:test";
import { renderToStaticMarkup } from "react-dom/server";

import { RoomProgress, shownProgress, type RoomProgressFields } from "./room-progress";

const room = (over: Partial<RoomProgressFields> = {}): RoomProgressFields => ({
  status: "open",
  progressPercent: 40,
  progressNote: "Tests written, review next",
  progressBotId: "b1",
  progressAt: new Date(Date.now() - 5 * 60_000).toISOString(),
  ...over,
});

describe("shownProgress", () => {
  test("is what the lead reported", () => expect(shownProgress(room())).toBe(40));
  test("is nothing until the lead has reported", () => {
    expect(shownProgress(room({ progressPercent: null, progressAt: null }))).toBeNull();
    expect(shownProgress(room({ progressAt: null }))).toBeNull();
  });
  test("is complete for a resolved room, whatever was last said, even with no report", () => {
    expect(shownProgress(room({ status: "resolved" }))).toBe(100);
    expect(
      shownProgress(room({ status: "resolved", progressPercent: null, progressAt: null })),
    ).toBe(100);
  });
  test("keeps 0 as a real value", () =>
    expect(shownProgress(room({ progressPercent: 0 }))).toBe(0));
});

describe("RoomProgress", () => {
  test("shows the percent, the note, who reported and when", () => {
    const html = renderToStaticMarkup(<RoomProgress room={room()} botName="Dev" />);
    expect(html).toContain("40%");
    expect(html).toContain("Tests written, review next");
    expect(html).toContain("Dev");
    expect(html).toContain("5m ago");
    expect(html).toContain('aria-label="Room progress"');
  });
  test("renders nothing before the first report", () => {
    const html = renderToStaticMarkup(
      <RoomProgress room={room({ progressPercent: null, progressAt: null })} botName="Dev" />,
    );
    expect(html).toBe("");
  });
  test("a resolved room reads 100% with no note needed", () => {
    const html = renderToStaticMarkup(
      <RoomProgress room={room({ status: "resolved", progressNote: "" })} botName="Dev" />,
    );
    expect(html).toContain("100%");
  });
  test("a note with markup is text, never HTML", () => {
    const html = renderToStaticMarkup(
      <RoomProgress room={room({ progressNote: "<img src=x onerror=alert(1)>" })} botName="Dev" />,
    );
    expect(html).not.toContain("<img");
    expect(html).toContain("&lt;img");
  });
});
