import type { Icon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

import { Button } from "@/components/ui";

/**
 * One line of a message's action menu: an icon and a word, as wide as the menu. Tall enough for a thumb on a touch screen; shorter in
 * the desktop toolbar's menu (the menu says which with `data-placement`).
 */
export function MenuRow({
  icon: Glyph,
  onClick,
  pressed,
  children,
}: {
  icon: Icon;
  onClick: () => void;
  pressed?: boolean | undefined;
  children: ReactNode;
}) {
  return (
    // No hint: the button has visible text.
    <Button
      type="button"
      role="menuitem"
      variant="ghost"
      // "!": the library's .__button centers its content and beat justify-start, so the menu read as a centered list.
      className="h-11 w-full !justify-start gap-3 px-3 text-sm in-data-[placement=toolbar]:!h-8"
      {...(pressed === undefined ? {} : { "aria-pressed": pressed })}
      onClick={onClick}
    >
      <Glyph aria-hidden="true" weight={pressed ? "fill" : "regular"} className="size-4" />
      {children}
    </Button>
  );
}
