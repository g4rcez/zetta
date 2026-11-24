/** Why a text could not be turned into speech. `safe` is a sentence for the person; nothing the provider says is passed on. */
export class SpeechError extends Error {
  constructor(
    readonly code:
      | "OFF"
      | "BROWSER"
      | "TOO_LONG"
      | "BUSY"
      | "PROVIDER_AUTH"
      | "NOT_CONFIGURED"
      | "FAILED",
    readonly safe: string,
  ) {
    super(code);
  }
}
