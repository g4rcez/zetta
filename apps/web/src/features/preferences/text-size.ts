/** Same values as the server (packages/db/src/schema/preferences.ts), which rejects anything else. */
export const TEXT_SIZES = ["small", "medium", "large"] as const;
export type TextSize = (typeof TEXT_SIZES)[number];
export const DEFAULT_TEXT_SIZE: TextSize = "medium";
export const TEXT_SIZE_LABEL: Record<TextSize, string> = {
  small: "Small",
  medium: "Medium",
  large: "Large",
};

/** Puts the size on the document, where `index.css` reads it. Medium is the stylesheet's own value, so it needs no attribute. */
export function applyTextSize(root: HTMLElement, size: TextSize) {
  if (size === DEFAULT_TEXT_SIZE) delete root.dataset.textSize;
  else root.dataset.textSize = size;
}
