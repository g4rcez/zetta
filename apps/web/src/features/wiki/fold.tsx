import { CaretRightIcon } from "@phosphor-icons/react";
import type { ReactNode } from "react";

/** A closed section under the list: the title and a count stay visible, the body opens on demand. */
export function Fold({
  title,
  count,
  children,
}: {
  title: string;
  count?: number;
  children: ReactNode;
}) {
  return (
    <details className="group border-t pt-3">
      <summary className="flex w-fit cursor-pointer items-center gap-1.5 rounded-md text-sm font-medium select-none hover:text-primary focus-visible:outline-2 focus-visible:outline-ring">
        <CaretRightIcon
          aria-hidden="true"
          className="size-3.5 text-muted-foreground transition-transform group-open:rotate-90"
        />
        {title}
        {count ? (
          <span className="font-normal tabular-nums text-muted-foreground">{count}</span>
        ) : null}
      </summary>
      <div className="mt-3 space-y-4">{children}</div>
    </details>
  );
}
