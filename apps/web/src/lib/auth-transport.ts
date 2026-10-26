export type AuthenticationFetch = (
  input: string | URL | Request,
  init?: RequestInit,
) => Promise<Response>;

type Deadline = (expire: () => void) => () => void;
const maximumResponseBytes = 1_048_576;

export class AuthenticationRequestError extends Error {
  constructor(public readonly code: "timeout" | "cancelled" | "unavailable" | "response_too_large") {
    super("The authentication request could not be completed. Check your connection and try again.");
    this.name = "AuthenticationRequestError";
  }
}

const startDeadline: Deadline = (expire) => {
  const timer = setTimeout(expire, 20_000);
  return () => clearTimeout(timer);
};

export function createAuthenticationFetch(
  fetcher: AuthenticationFetch = fetch,
  deadline: Deadline = startDeadline,
): AuthenticationFetch {
  return async (input, init) => {
    const callerSignal =
      init?.signal === undefined && input instanceof Request ? input.signal : init?.signal;
    if (callerSignal?.aborted) throw new AuthenticationRequestError("cancelled");
    const controller = new AbortController();
    let response: Response | undefined;
    let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
    let complete = false;
    const interrupted = Promise.withResolvers<never>();
    const cancel = () => {
      const failure = new AuthenticationRequestError("cancelled");
      controller.abort(failure);
      interrupted.reject(failure);
    };
    callerSignal?.addEventListener("abort", cancel, { once: true });
    const expired = Promise.withResolvers<never>();
    const stopDeadline = deadline(() => {
      const failure = new AuthenticationRequestError("timeout");
      controller.abort(failure);
      expired.reject(failure);
    });

    async function execute() {
      response = await fetcher(input, { ...init, signal: controller.signal });
      if (controller.signal.aborted) {
        void Promise.allSettled([response.body?.cancel()]);
        throw new AuthenticationRequestError("cancelled");
      }
      // Drain a bounded clone so Better Auth receives the original response and its metadata.
      reader = response.clone().body?.getReader();
      if (reader) {
        let bytes = 0;
        while (true) {
          const chunk = await reader.read();
          if (chunk.done) break;
          bytes += chunk.value.byteLength;
          if (bytes > maximumResponseBytes) throw new AuthenticationRequestError("response_too_large");
        }
      }
      return response;
    }

    try {
      const result = await Promise.race([execute(), expired.promise, interrupted.promise]);
      complete = true;
      return result;
    } catch (failure) {
      if (failure instanceof AuthenticationRequestError) throw failure;
      throw new AuthenticationRequestError("unavailable");
    } finally {
      stopDeadline();
      callerSignal?.removeEventListener("abort", cancel);
      if (!complete) {
        controller.abort();
        void Promise.allSettled([reader?.cancel(), response?.body?.cancel()]);
      }
      reader?.releaseLock();
    }
  };
}
