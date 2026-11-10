/** Why a bot import stopped. The routes turn these into HTTP answers, and Chief shows the message to the person. */
export type ImportErrorCode =
  /** The link is not a Grok Bot marketplace bot page. */
  | "BAD_URL"
  /** The marketplace has no bot with that id. */
  | "NOT_FOUND"
  /** The page loaded but its bot data is not where we expect it: the site changed and the importer needs an update. */
  | "PAGE_CHANGED"
  /** The marketplace could not be reached, answered an error, or sent too much. */
  | "FETCH_FAILED"
  /** The person's Chief has no usable engine to write the skills with. */
  | "NO_CHIEF_ENGINE"
  /** The engine answered, but not with a draft we can use, twice. */
  | "ANALYZE_FAILED"
  /** The draft sent for install is not valid (edited into something over a limit, for example). */
  | "INVALID_DRAFT"
  /** Installing would go over a limit (skills per bot or per account). */
  | "FULL"
  /** A skill or note with that name already exists and could not be renamed. */
  | "DUPLICATE";

export class ImportError extends Error {
  constructor(
    readonly code: ImportErrorCode,
    message: string,
  ) {
    super(message);
    this.name = "ImportError";
  }
}
