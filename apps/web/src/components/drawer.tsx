import type { ReactNode } from "react";
import { Modal } from "@/components/ui";

type Props = { open: boolean; onClose: () => void; title: ReactNode; description?: string; footer?: ReactNode; children: ReactNode };

/**
 * Side sheet that slides in from the right (full width on phones). Built on the library Modal's `drawer` type,
 * which provides the focus trap, Escape-to-close, scroll lock and aria-modal. `forceType` keeps it a side drawer on mobile
 * instead of the library's default bottom sheet; the overlay closes it.
 */
export function Drawer({ open, onClose, title, description, footer, children }: Props) {
  return (
    <Modal open={open} onChange={(next: boolean) => { if (!next) onClose(); }} type="drawer" position="right" forceType overlayClickClose
      title={title} ariaTitle={typeof title === "string" ? title : "Drawer"} {...(description ? { ariaDescription: description } : {})} {...(footer ? { footer } : {})}
      className="w-full max-w-full sm:w-[34rem] sm:max-w-[34rem]">
      {children}
    </Modal>
  );
}
