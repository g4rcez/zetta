type ReservedClient = {
  on(event: "error", listener: () => void): unknown;
  once(event: "end", listener: () => void): unknown;
  release(): void;
};
type OwnedPool = {
  on(event: "connect", listener: (client: ReservedClient) => void): unknown;
  on(event: "error", listener: () => void): unknown;
  end(): Promise<void>;
};

/** Lifecycle ownership only; pg construction, reservation and SQL stay in the DB opener. */
export function createAdminOperatorClientOwner(pool: OwnedPool) {
  let failed = false;
  let client: ReservedClient | undefined;
  let termination: Promise<void> | undefined;
  let closing: Promise<void> | undefined;
  const observed = new WeakMap<ReservedClient, Promise<void>>();
  const healthy = () => { if (failed) throw new Error("Admin operator client unavailable."); };
  // pg emits connect before handing out the client; retain even an end before reservation.
  pool.on("connect", (connected) => {
    connected.on("error", () => { failed = true; });
    observed.set(connected, new Promise<void>((resolve) => { connected.once("end", resolve); }));
  });
  pool.on("error", () => { failed = true; });
  const reserve = (reserved: ReservedClient) => {
    client = reserved;
    termination = observed.get(reserved);
    if (!termination) throw new Error("Admin operator client unavailable.");
  };
  const close = () => {
    closing ??= (async () => {
      const shutdown = (async () => {
        try { client?.release(); }
        finally { client = undefined; await pool.end(); }
      })();
      // pg-pool can resolve end before the client's end event. A shutdown rejection
      // must not short-circuit that wait and let the executable clear its deadline.
      const results = await Promise.allSettled([shutdown, termination]);
      if (results.some((result) => result.status === "rejected")) {
        failed = true;
        throw new Error("Admin operator client unavailable.");
      }
    })();
    return closing;
  };
  return { reserve, close, healthy };
}
