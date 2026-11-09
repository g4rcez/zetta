import { useEffect, useLayoutEffect, useRef, useState } from "react";
import { cn } from "@zetta/ui/lib/utils";

type Phase = "connecting" | "live" | "ended" | "unavailable";
/** Characters kept on screen; a command that prints for hours shows its latest part. */
const KEEP = 200_000;

const STATUS: Record<Phase, string> = {
  connecting: "Connecting",
  live: "Live",
  ended: "Finished",
  unavailable: "Not available",
};

/**
 * What a command of the running turn prints, as it prints it. It is a stream, not a record: the server keeps no copy, so it is only
 * there while the bot works. Each connection starts from the latest part of the output, so a reconnect starts the text over.
 */
export function StepOutput({ url, label }: { url: string; label: string }) {
  const [text, setText] = useState("");
  const [phase, setPhase] = useState<Phase>("connecting");
  const pre = useRef<HTMLPreElement>(null);
  const atBottom = useRef(true);
  useEffect(() => {
    setText("");
    setPhase("connecting");
    const source = new EventSource(url, { withCredentials: true });
    source.onopen = () => {
      setText("");
      setPhase("live");
    };
    source.onmessage = (e) => {
      try {
        const ev = JSON.parse(e.data) as { type?: string; text?: string };
        if (ev.type === "chunk" && typeof ev.text === "string") {
          const piece = ev.text;
          setText((t) => (t.length + piece.length > KEEP ? (t + piece).slice(-KEEP) : t + piece));
        } else if (ev.type === "end") {
          setPhase("ended");
          source.close();
        } else if (ev.type === "error") setPhase("unavailable");
      } catch {
        /* a frame that is not ours */
      }
    };
    // A dropped connection retries by itself; a refusal (the step is gone or is not yours) closes it for good.
    source.onerror = () => {
      if (source.readyState === EventSource.CLOSED)
        setPhase((p) => (p === "ended" ? p : "unavailable"));
    };
    return () => source.close();
  }, [url]);
  // Follows the newest line only while the reader sits at the bottom.
  useLayoutEffect(() => {
    const el = pre.current;
    if (el && atBottom.current) el.scrollTop = el.scrollHeight;
  }, [text]);
  const empty =
    phase === "unavailable"
      ? "Output is not available here."
      : phase === "ended"
        ? "No output."
        : "Waiting for output…";
  return (
    <div className="mt-1 space-y-1">
      <pre
        ref={pre}
        tabIndex={0}
        aria-label={`Output of ${label}`}
        onScroll={(e) => {
          const el = e.currentTarget;
          atBottom.current = el.scrollHeight - el.scrollTop - el.clientHeight <= 8;
        }}
        className="max-h-64 overflow-auto overscroll-contain whitespace-pre-wrap break-all rounded border bg-background/60 p-2 font-mono text-[11px] leading-4 text-foreground/90 focus-visible:-outline-offset-2 focus-visible:outline-2 focus-visible:outline-ring"
      >
        {text || <span className="text-muted-foreground">{empty}</span>}
      </pre>
      <p className="flex items-center gap-1.5 text-[11px] text-muted-foreground/70">
        <span
          aria-hidden="true"
          className={cn(
            "size-1.5 rounded-full bg-muted-foreground/50",
            phase === "live" && "animate-pulse bg-primary motion-reduce:animate-none",
          )}
        />
        {STATUS[phase]} · not saved
      </p>
    </div>
  );
}
