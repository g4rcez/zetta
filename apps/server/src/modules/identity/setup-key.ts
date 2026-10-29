import { createHash, timingSafeEqual } from "node:crypto";

const digest = (value: string) => createHash("sha256").update(value).digest();

/** Constant-time check of a typed key. Hashing first hides the key length and bounds the work. */
export function matchesConnectionKey(candidate: string, key: string): boolean {
  if (candidate.length === 0 || candidate.length > 512) return false;
  return timingSafeEqual(digest(candidate), digest(key));
}
