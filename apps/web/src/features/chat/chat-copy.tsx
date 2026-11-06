import { useEffect, useRef, useState } from "react";
import { CheckIcon, CopyIcon } from "@phosphor-icons/react";

import { ActionHint } from "@zetta/ui/components/action-hint";
import { Button } from "@/components/ui";

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
  const [done, setDone] = useState(false);
  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);
  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      setDone(true);
      clearTimeout(timer.current);
      timer.current = setTimeout(() => setDone(false), 1500);
    } catch {
      setDone(false);
    }
  }
  return (
    <ActionHint label={done ? "Copied!" : label}>
      <Button
        type="button"
        size="icon-sm"
        variant="ghost"
        className={className}
        aria-label={done ? "Copied" : label}
        onClick={() => void copy()}
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
