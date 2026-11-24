import { describe, expect, test } from "bun:test";

import { filterPhoneRows, parsePhoneSearch, type PhoneFilterRow } from "./phone-filters";

describe("parsePhoneSearch", () => {
  test("an empty address is the default view", () => {
    expect(parsePhoneSearch({})).toEqual({});
  });
  test("keeps a known status, provider and text", () => {
    expect(parsePhoneSearch({ status: "held", provider: "twilio", q: "  ana " })).toEqual({
      status: "held",
      provider: "twilio",
      q: "ana",
    });
  });
  test("drops what it does not understand", () => {
    expect(
      parsePhoneSearch({ status: "released", provider: "vonage", q: "   ", extra: "x" }),
    ).toEqual({});
    expect(parsePhoneSearch({ status: ["active"], provider: 3, q: 7 })).toEqual({});
  });
  test("cuts a very long text", () => {
    expect(parsePhoneSearch({ q: "a".repeat(500) }).q).toHaveLength(100);
  });
});

const row = (over: Partial<PhoneFilterRow>): PhoneFilterRow => ({
  status: "active",
  provider: "telnyx",
  number: "+12025550101",
  botName: "Helper",
  ownerName: "Ana Souza",
  ...over,
});
const rows = [
  row({}),
  row({ status: "requested", number: null, botName: "Zetta", ownerName: "Bruno" }),
  row({ provider: "twilio", number: "+12025550102", botName: "Scout", ownerName: "Bruno" }),
  row({ status: "held", provider: "twilio", number: "+12025550103", ownerName: null }),
];

describe("filterPhoneRows", () => {
  test("no filter keeps every row in order", () => {
    expect(filterPhoneRows(rows, {})).toEqual(rows);
  });
  test("status and provider narrow together", () => {
    expect(filterPhoneRows(rows, { status: "held" })).toEqual([rows[3]!]);
    expect(filterPhoneRows(rows, { provider: "twilio" })).toEqual([rows[2]!, rows[3]!]);
    expect(filterPhoneRows(rows, { provider: "twilio", status: "active" })).toEqual([rows[2]!]);
  });
  test("the text matches the bot, the owner and the digits of the number", () => {
    expect(filterPhoneRows(rows, { q: "zetta" })).toEqual([rows[1]!]);
    expect(filterPhoneRows(rows, { q: "bruno" })).toEqual([rows[1]!, rows[2]!]);
    expect(filterPhoneRows(rows, { q: "(202) 555-0102" })).toEqual([rows[2]!]);
    expect(filterPhoneRows(rows, { q: "nobody" })).toEqual([]);
  });
});
