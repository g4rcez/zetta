/** Saves a per-browser preference: a string as it is, anything else as JSON. Storage can be unavailable (private mode); then the choice lasts for this session. */
export const saveLocal = (key: string, value: unknown) => {
  try {
    localStorage.setItem(key, typeof value === "string" ? value : JSON.stringify(value));
  } catch {
    // Storage unavailable: nothing to do.
  }
};
