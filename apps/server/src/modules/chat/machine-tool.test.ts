import { describe, expect, test } from "bun:test";
import { parseTools } from "./tools";

const block = (json: string) => "```zetta:machine\n" + json + "\n```";

describe("zetta:machine blocks", () => {
  test("each action parses to a call and is removed from the reply", () => {
    const r = parseTools(
      [
        block('{"action":"run","machine":"Web server","command":"uname -a"}'),
        block('{"action":"list","machine":"Files","path":"/pub"}'),
        block('{"action":"get","machine":"Files","remote":"/pub/a.txt","local":"a.txt"}'),
        block('{"action":"put","machine":"Files","local":"b.txt","remote":"/in/b.txt"}'),
        "Done.",
      ].join("\n"),
    );
    expect(r.text).toBe("Done.");
    expect(r.rejected).toEqual([]);
    expect(r.calls.map((c) => c.kind === "machine" && c.args.action)).toEqual([
      "run",
      "list",
      "get",
      "put",
    ]);
  });

  test("a block with a secret field, an unknown action or a missing machine is rejected", () => {
    const r = parseTools(
      [
        block('{"action":"run","machine":"Web server","command":"id","password":"x"}'),
        block('{"action":"shell","machine":"Web server","command":"id"}'),
        block('{"action":"run","command":"id"}'),
        block('{"action":"run","machine":"Web server","command":""}'),
      ].join("\n"),
    );
    expect(r.calls).toEqual([]);
    expect(r.rejected.map((x) => x.kind)).toEqual(["machine", "machine", "machine", "machine"]);
  });
});
