import { describe, expect, it } from "bun:test";
import { catchUpItemSearch, parseCatchUpSearch } from "./catch-up-search";

const ID = "01a1ce15-6b98-7fa6-a72d-0885e1cc5117";

describe("parseCatchUpSearch", () => {
  it("leaves an empty address empty", () => {
    expect(parseCatchUpSearch({})).toEqual({});
  });

  it("keeps a bot id and a card key", () => {
    expect(parseCatchUpSearch({ bot: ID, item: `card:${ID}` })).toEqual({
      bot: ID,
      item: `card:${ID}`,
    });
    expect(parseCatchUpSearch({ item: `proposal:${ID}` })).toEqual({ item: `proposal:${ID}` });
  });

  it("drops what it does not understand", () => {
    expect(parseCatchUpSearch({ bot: "nope", item: "card:1", extra: "x" })).toEqual({});
    expect(parseCatchUpSearch({ bot: 5, item: ["card"] })).toEqual({});
    expect(parseCatchUpSearch({ item: `task:${ID}` })).toEqual({});
  });
});

describe("catchUpItemSearch", () => {
  it("points the page at one card", () => {
    expect(catchUpItemSearch(`card:${ID}`)).toEqual({ item: `card:${ID}` });
    expect(catchUpItemSearch("whatever")).toEqual({});
  });
});
