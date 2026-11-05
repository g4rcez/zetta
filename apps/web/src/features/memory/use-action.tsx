import { useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { memoryError } from "./memory-api";

/** Runs one action and shows its result or its error next to the form. Then every memory read loads again, unless `after` says otherwise. */
export function useAction(after?: () => Promise<unknown> | void) {
  const qc = useQueryClient();
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(undefined);
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
    } catch (e) {
      setError(memoryError(e));
    }
    await (after ? after() : qc.invalidateQueries({ queryKey: ["memory"] }));
  };
  const feedback = (
    <>
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
      {error && (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      )}
    </>
  );
  return { run, feedback, setError };
}
