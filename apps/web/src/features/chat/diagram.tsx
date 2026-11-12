import { useEffect, useState } from "react";
import type { CustomRendererProps } from "streamdown";

type Drawn =
  | { kind: "loading" }
  | { kind: "svg"; svg: string }
  | { kind: "error"; message: string };

/** What Pele reports for a diagram it cannot draw: its message, and where in the source when it knows (only a `PeleError` has a `code`; Bun puts `line` on any error). */
export function diagramError(error: unknown): string {
  if (!(error instanceof Error)) return "The diagram could not be drawn.";
  const at = error as Error & { code?: unknown; line?: unknown; column?: unknown };
  if (typeof at.code !== "string" || typeof at.line !== "number" || at.line < 1)
    return error.message;
  return `${error.message} (line ${at.line}${typeof at.column === "number" && at.column > 0 ? `, column ${at.column}` : ""})`;
}

/** The diagram's source as plain text, for a reply that is still streaming or a diagram that cannot be drawn. */
function Source({ code, note }: { code: string; note?: string | undefined }) {
  return (
    <figure className="my-2 overflow-hidden rounded-lg border bg-muted/30 text-xs">
      <pre className="max-h-72 overflow-auto p-3">
        <code>{code}</code>
      </pre>
      {note ? (
        <figcaption role="alert" className="border-t px-3 py-1.5 text-destructive">
          {note}
        </figcaption>
      ) : null}
    </figure>
  );
}

/**
 * A ```mermaid block drawn by Pele (https://pele.run): a small SVG renderer that styles itself with CSS variables (see `.pele` in
 * index.css). Pele is loaded on first use, so it stays out of the main bundle. While the block is still streaming the code shows as
 * text. Pele escapes the diagram text and blocks `javascript:` and `data:` links, so its SVG is the only markup inserted here; the
 * diagram's author never passes options or config, and an error is shown as text, never as markup.
 */
export function PeleDiagram({ code, isIncomplete }: CustomRendererProps) {
  const [drawn, setDrawn] = useState<Drawn>({ kind: "loading" });
  useEffect(() => {
    if (isIncomplete) return;
    let current = true;
    setDrawn({ kind: "loading" });
    import("pele/lazy")
      .then(({ renderAsync }) => renderAsync(code))
      .then((result) => current && setDrawn({ kind: "svg", svg: result.svg }))
      .catch(
        (error: unknown) => current && setDrawn({ kind: "error", message: diagramError(error) }),
      );
    return () => {
      current = false;
    };
  }, [code, isIncomplete]);
  if (isIncomplete || drawn.kind === "loading") return <Source code={code} />;
  if (drawn.kind === "error") return <Source code={code} note={drawn.message} />;
  return (
    <figure
      aria-label="Diagram"
      className="pele my-2 max-w-full overflow-x-auto rounded-lg border p-3"
      // Pele's own output: see the comment above the component.
      dangerouslySetInnerHTML={{ __html: drawn.svg }}
    />
  );
}
