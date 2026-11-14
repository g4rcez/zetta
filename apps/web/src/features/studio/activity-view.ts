/** Activity has two views, kept in the address (`?view=updates`). Anything else is the trail. Kept apart from the page so Studio can read it without loading it. */
export type ActivityView = "trail" | "updates";
export const parseActivityView = (raw: unknown): ActivityView =>
  raw === "updates" ? "updates" : "trail";
