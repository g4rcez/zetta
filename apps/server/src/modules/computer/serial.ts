/** Runs async jobs one after another per key (e.g. per user), so check-then-create sequences cannot interleave. */
export function createSerializer() {
  const tails = new Map<string, Promise<unknown>>();
  return <T>(key: string, job: () => Promise<T>): Promise<T> => {
    const run = (tails.get(key) ?? Promise.resolve()).catch(() => undefined).then(job);
    tails.set(key, run);
    void run.finally(() => { if (tails.get(key) === run) tails.delete(key); }).catch(() => undefined);
    return run;
  };
}
