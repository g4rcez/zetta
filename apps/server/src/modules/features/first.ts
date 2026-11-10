import { AccessError } from "../identity/access";

/** The first row, or NOT_FOUND when the query matched none. */
export const first = <T>(rows: T[]): T => {
  if (!rows[0]) throw new AccessError("NOT_FOUND");
  return rows[0];
};
