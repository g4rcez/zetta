import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import { ActionHint } from "@/components/action-hint";
import { Button } from "@/components/ui";
import { useCopy } from "../shared/use-copy";

const ignoreCopyFailure = () => {};

/** Copies `text` to the clipboard; reports success for a moment. Never throws when the clipboard is unavailable. */
export function CopyButton({
  text,
  label = "Copy",
  className = "",
}: {
  text: string;
  label?: string;
  className?: string;
}) {
  const { copied: done, copy } = useCopy(ignoreCopyFailure);
  return (
    <ActionHint label={done ? "Copied!" : label} closeOnClick={false}>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className={className}
        aria-label={done ? "Copied" : label}
        onClick={() => void copy(text)}
      >
        {done ? <CheckIcon /> : <CopyIcon />}
      </Button>
    </ActionHint>
  );
}

export function CodeBlock({ text }: { text: string }) {
  return (
    <div className="chat-code">
      <CopyButton text={text} label="Copy code" className="chat-code-copy" />
      <pre tabIndex={0} aria-label="Code">
        <code>{text}</code>
      </pre>
    </div>
  );
}
