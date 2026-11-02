import { useState } from "react";

import { wikiError } from "./wiki-api";

/** Runs one action and shows its result or its error next to the form. */
export function useAction(after: () => Promise<unknown> | void) {
  const [error, setError] = useState<string>();
  const [status, setStatus] = useState<string>();
  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(undefined);
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
    } catch (e) {
      setError(wikiError(e));
    }
    await after();
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
