import { describe, expect, test } from "bun:test";
import { transaction } from "./transaction";

const deadlock = Object.assign(new Error("deadlock detected"), { code: "40P01" });
/** A database whose transactions fail with the given errors, one per attempt, and then succeed. */
const dbFailing = (errors: unknown[]) => {
  let calls = 0;
  const db = {
    transaction: async (run: (tx: never) => Promise<unknown>) => {
      const error = errors[calls++];
      if (error) throw error;
      return run({} as never);
    },
  };
  return { db: db as never, calls: () => calls };
};

describe("transaction", () => {
  test("returns what the transaction returns", async () => {
    const { db, calls } = dbFailing([]);
    expect(await transaction(db, async () => "done")).toBe("done");
    expect(calls()).toBe(1);
  });

  test("runs a deadlock victim again and returns its result", async () => {
    const { db, calls } = dbFailing([deadlock]);
    expect(await transaction(db, async () => "done")).toBe("done");
    expect(calls()).toBe(2);
  });

  test("recognizes the deadlock inside the driver's wrapper error", async () => {
    const wrapped = Object.assign(new Error("Failed query"), { cause: { code: "40P01" } });
    const { db, calls } = dbFailing([wrapped, wrapped]);
    expect(await transaction(db, async () => "done")).toBe("done");
    expect(calls()).toBe(3);
  });

  test("gives up after three deadlocks with the last error", async () => {
    const { db, calls } = dbFailing([deadlock, deadlock, deadlock, deadlock]);
    await expect(transaction(db, async () => "never")).rejects.toBe(deadlock);
    expect(calls()).toBe(3);
  });

  test("any other error is thrown at once, not retried", async () => {
    const duplicate = Object.assign(new Error("duplicate key"), { code: "23505" });
    const { db, calls } = dbFailing([duplicate]);
    await expect(transaction(db, async () => "never")).rejects.toBe(duplicate);
    expect(calls()).toBe(1);
  });
});
