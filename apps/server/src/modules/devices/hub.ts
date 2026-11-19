import { ComputerError } from "../computer/service";

/** The side of a device's open connection the hub needs. */
export type DeviceSocket = { send(data: string): void; close(): void };

type Pending = {
  resolve(value: unknown): void;
  reject(error: Error): void;
  timer: ReturnType<typeof setTimeout>;
  deviceId: string;
};

/**
 * The open connections of devices, and requests to them. A device connects to the server (so it works behind a router) and answers one
 * request at a time by id. One connection per device: a new one replaces the old. A request fails when the device is not connected, when it
 * answers with an error, when it takes too long, or when its connection closes first.
 */
export function createDeviceHub(options: { timeoutMs?: number; newId?: () => string } = {}) {
  const { timeoutMs = 300_000, newId = () => crypto.randomUUID() } = options;
  const sockets = new Map<string, DeviceSocket>();
  const pending = new Map<string, Pending>();

  const failAll = (deviceId: string, error: Error) => {
    for (const [id, call] of pending)
      if (call.deviceId === deviceId) {
        clearTimeout(call.timer);
        pending.delete(id);
        call.reject(error);
      }
  };

  return {
    online: (deviceId: string) => sockets.has(deviceId),
    onlineIds: () => [...sockets.keys()],
    attach(deviceId: string, socket: DeviceSocket) {
      const old = sockets.get(deviceId);
      sockets.set(deviceId, socket);
      if (old && old !== socket) {
        failAll(deviceId, new ComputerError("UNREACHABLE"));
        try {
          old.close();
        } catch {}
      }
    },
    /** Only the connection that is current counts: a replaced one closing late must not drop its successor. */
    detach(deviceId: string, socket: DeviceSocket) {
      if (sockets.get(deviceId) !== socket) return;
      sockets.delete(deviceId);
      failAll(deviceId, new ComputerError("UNREACHABLE"));
    },
    /** Closes a device's connection (it was revoked). */
    drop(deviceId: string) {
      const socket = sockets.get(deviceId);
      if (!socket) return;
      sockets.delete(deviceId);
      failAll(deviceId, new ComputerError("REVOKED"));
      try {
        socket.close();
      } catch {}
    },
    /** A message from a device: the answer to a request. Anything else is ignored. */
    receive(deviceId: string, raw: string) {
      let message: { id?: unknown; result?: unknown; error?: unknown };
      try {
        message = JSON.parse(raw);
      } catch {
        return;
      }
      if (typeof message.id !== "string") return;
      const call = pending.get(message.id);
      // An answer counts only from the device that was asked.
      if (!call || call.deviceId !== deviceId) return;
      clearTimeout(call.timer);
      pending.delete(message.id);
      if (message.error !== undefined) {
        const code = (message.error as { code?: unknown } | null)?.code;
        call.reject(
          new ComputerError(
            code === "DENIED" ? "DENIED" : code === "UNSUPPORTED" ? "UNSUPPORTED" : "UNAVAILABLE",
          ),
        );
      } else call.resolve(message.result);
    },
    call(
      deviceId: string,
      method: string,
      params: Record<string, unknown>,
      opts: { signal?: AbortSignal; timeoutMs?: number } = {},
    ): Promise<unknown> {
      const socket = sockets.get(deviceId);
      if (!socket) return Promise.reject(new ComputerError("UNREACHABLE"));
      return new Promise((resolve, reject) => {
        const id = newId();
        const timer = setTimeout(() => {
          pending.delete(id);
          reject(new ComputerError("SLOW"));
        }, opts.timeoutMs ?? timeoutMs);
        pending.set(id, { resolve, reject, timer, deviceId });
        opts.signal?.addEventListener("abort", () => {
          if (!pending.delete(id)) return;
          clearTimeout(timer);
          reject(new ComputerError("SLOW"));
        });
        try {
          socket.send(JSON.stringify({ id, method, params }));
        } catch {
          clearTimeout(timer);
          pending.delete(id);
          reject(new ComputerError("UNREACHABLE"));
        }
      });
    },
  };
}

export type DeviceHub = ReturnType<typeof createDeviceHub>;
