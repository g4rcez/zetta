import { expect, test } from "bun:test";
import { PendingCreate, reconcileOwned } from "./execution-isolation-recovery";

test("unresolved create denies reconciliation before reading even a nonexistent journal", async () => {
  // Given an operation without a settled create receipt and no accessible journal.
  const root = "/nonexistent/synthetic-recovery";
  // When restart reconciliation is requested.
  const result = reconcileOwned(root, false);
  // Then quarantine takes precedence over filesystem access or resource removal.
  await expect(result).rejects.toBeInstanceOf(PendingCreate);
});

test("settled receipt cannot authorize an arbitrary journal directory", async () => {
  // Given an unowned path despite a claimed receipt.
  const root = "/tmp";
  // When reconciliation attempts to load its descriptor.
  const result = reconcileOwned(root, true);
  // Then fixed task-root authority blocks before a Docker call.
  await expect(result).rejects.toThrow("recovery blocked");
});
