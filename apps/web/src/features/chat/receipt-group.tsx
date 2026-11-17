import { CalendarPlusIcon, CaretRightIcon, CodeIcon, ListChecksIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Receipt } from "./chat-client";
import type { ReceiptGroup } from "./receipts";

const LINK = "hover:text-foreground hover:underline";

/** What the group says it did, with the thing it did it to: "updated 4 tasks", "added 3 agenda items". */
function summary(g: ReceiptGroup): string {
  const n = g.items.length;
  if (g.kind === "task")
    return `${g.created ? "added" : "updated"} ${n} ${n === 1 ? "task" : "tasks"}`;
  if (g.kind === "agenda")
    return `${g.created ? "added" : "updated"} ${n} ${n === 1 ? "agenda item" : "agenda items"}`;
  return `${g.created ? "created" : "ran or changed"} ${n} ${n === 1 ? "playground" : "playgrounds"}`;
}

function GroupIcon({ kind }: { kind: Receipt["kind"] }) {
  const className = "size-3.5";
  if (kind === "agenda") return <CalendarPlusIcon aria-hidden="true" className={className} />;
  if (kind === "playground") return <CodeIcon aria-hidden="true" className={className} />;
  return <ListChecksIcon aria-hidden="true" className={className} />;
}

/** One receipt of a group, as a link to the thing. */
function GroupItem({ r }: { r: Receipt }): ReactNode {
  if (r.kind === "agenda")
    return (
      <Link to="/agenda" search={{ item: r.id }} className={LINK}>
        {r.text}
      </Link>
    );
  if (r.kind === "playground")
    return (
      <Link to="/playground/$id" params={{ id: r.id }} className={LINK}>
        {r.text}
      </Link>
    );
  return (
    <Link to="/tasks/$taskId" params={{ taskId: r.id }} className={LINK}>
      {r.text}
    </Link>
  );
}

/**
 * Several receipts of one kind and verb as one chip: the icon and "updated 4 tasks". It opens to list each one, so nothing is lost and the
 * reply is not filled with lines that start with the same word.
 */
export function ReceiptGroupChip({ group }: { group: ReceiptGroup }) {
  return (
    <details className="group/receipts">
      <summary className="flex w-fit cursor-pointer list-none items-center gap-1 rounded-md hover:text-foreground focus-visible:outline-2 focus-visible:outline-ring [&::-webkit-details-marker]:hidden">
        <GroupIcon kind={group.kind} />
        {summary(group)}
        <CaretRightIcon
          aria-hidden="true"
          className="size-3 transition-transform group-open/receipts:rotate-90 motion-reduce:transition-none"
        />
      </summary>
      <ul aria-label={summary(group)} className="mt-1 space-y-0.5 pl-5">
        {group.items.map((r) => (
          <li key={`${r.kind}-${r.id}`} className="truncate">
            <GroupItem r={r} />
          </li>
        ))}
      </ul>
    </details>
  );
}
