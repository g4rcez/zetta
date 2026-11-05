import type { ReactNode } from "react";

/** One part of the Preferences page: a flat block under a hairline, not a card. `id` lets a link jump to it. */
export function Section({
  id,
  title,
  description,
  children,
}: {
  id: string;
  title: string;
  description: string;
  children: ReactNode;
}) {
  return (
    <section
      id={id}
      aria-labelledby={`${id}-title`}
      className="space-y-4 border-t pt-6 first:border-t-0 first:pt-0"
    >
      <header className="space-y-1">
        <h2 id={`${id}-title`} className="text-base font-medium">
          {title}
        </h2>
        <p className="text-sm text-muted-foreground">{description}</p>
      </header>
      {children}
    </section>
  );
}
