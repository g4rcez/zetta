import type { OrgLink, OrgPosition } from "./org-api";
import { namedLinks } from "./org-links";

/**
 * The "works with" pairs as a list: the same facts as the dotted lines, in words. It is how the outline view, a phone and a screen
 * reader get the layer.
 */
export function OrgWorksList({
  links,
  positions,
  error,
}: {
  links: readonly OrgLink[] | undefined;
  positions: readonly OrgPosition[];
  error: string | undefined;
}) {
  const pairs = links ? namedLinks(links, positions) : [];
  return (
    <section aria-label="Who works with whom" className="mt-6 space-y-2">
      <h2 className="text-base font-semibold">Who works with whom</h2>
      {error ? (
        <p role="alert" className="text-sm text-destructive">
          {error}
        </p>
      ) : !links ? (
        <p role="status" className="text-sm text-muted-foreground">
          Looking at rooms, workflows and handoffs…
        </p>
      ) : pairs.length === 0 ? (
        <p className="max-w-prose text-sm text-pretty text-muted-foreground">
          No two bots of the chart work together yet. Shared rooms, workflow steps and decision
          handoffs show up here.
        </p>
      ) : (
        <ul className="space-y-1.5 text-sm">
          {pairs.map((p) => (
            <li key={`${p.link.aId}|${p.link.bId}`} className="rounded-lg border bg-card px-3 py-2">
              <span className="font-medium">
                {p.names[0]} and {p.names[1]}
              </span>
              <span className="text-muted-foreground">: {p.sentence}</span>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
