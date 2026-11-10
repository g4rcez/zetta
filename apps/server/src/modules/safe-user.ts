/** A user id as one folder name: anything outside `A-Za-z0-9_-` becomes `_`, so it can never leave its parent folder. */
export const safeUser = (userId: string) => userId.replace(/[^A-Za-z0-9_-]/g, "_");
