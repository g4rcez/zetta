import { CalendarPlusIcon, CodeIcon, ListChecksIcon } from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import type { ReactNode } from "react";

import type { Receipt } from "./chat-client";
import { Disclosure } from "./disclosure";
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
  if (kind === "agenda") return <CalendarPlusIcon />;
  if (kind === "playground") return <CodeIcon />;
  return <ListChecksIcon />;
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
    <Disclosure icon={<GroupIcon kind={group.kind} />} label={summary(group)}>
      <ul aria-label={summary(group)} className="mt-1 space-y-0.5 pl-5">
        {group.items.map((r) => (
          <li key={`${r.kind}-${r.id}`} className="truncate">
            <GroupItem r={r} />
          </li>
        ))}
      </ul>
    </Disclosure>
  );
}
