import { CheckIcon, CopyIcon, ArrowSquareOutIcon } from "@phosphor-icons/react";
import type { LinkSafetyModalProps } from "streamdown";
import { Button, Modal } from "@/components/ui";
import { toast } from "@/lib/notify";
import { useCopy } from "../shared/use-copy";

/** Asks before a link in a reply leaves the app. The dialog is the library `Modal`, so focus, Escape and the overlay behave like every other dialog. */
export function LinkSafetyModal({ isOpen, onClose, onConfirm, url }: LinkSafetyModalProps) {
  const { copied, copy } = useCopy(() => toast.error("Could not copy the link"));
  return (
    <Modal
      open={isOpen}
      onChange={(open: boolean) => {
        if (!open) onClose();
      }}
      title="Open external link?"
      ariaDescription="You're about to visit an external website."
      overlayClickClose
    >
      <div className="flex flex-col gap-3 text-sm">
        <p className="text-muted-foreground">You&apos;re about to visit an external website.</p>
        <p className="rounded-md bg-muted px-3 py-2 font-mono text-sm break-all">{url}</p>
        <div className="grid grid-cols-2 gap-2">
          <Button type="button" variant="outline" onClick={() => void copy(url)}>
            {copied ? <CheckIcon aria-hidden="true" /> : <CopyIcon aria-hidden="true" />}
            {copied ? "Copied" : "Copy link"}
          </Button>
          <Button
            type="button"
            onClick={() => {
              onConfirm();
              onClose();
            }}
          >
            <ArrowSquareOutIcon aria-hidden="true" />
            Open link
          </Button>
        </div>
      </div>
    </Modal>
  );
}
