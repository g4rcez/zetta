import type { ReactNode } from "react";

import { cn } from "@zetta/ui/lib/utils";
import { Dropdown } from "@/components/ui";
import { UserAvatar } from "@/components/user-avatar";
import { PersonCard } from "@/features/people/person-card";

/** The part of a person the row needs. `title` is their job title, or the title of their company-chart seat when they wrote none. */
export type PersonLike = {
  userId?: string;
  name: string;
  avatar?: unknown;
  title?: string | null | undefined;
};

/** The row itself: picture, name and a muted line under it. Shared by the plain and the clickable form. */
function PersonRow({
  person,
  size,
  sub,
  trailing,
  className,
}: {
  person: PersonLike;
  size: number;
  sub?: ReactNode;
  trailing?: ReactNode;
  className?: string | undefined;
}) {
  const line = sub ?? person.title;
  return (
    <span className={cn("flex min-w-0 items-center gap-2.5 text-left", className)}>
      <UserAvatar name={person.name} avatar={person.avatar} size={size} />
      <span className="min-w-0 flex-1">
        <span className="flex items-center gap-2">
          <span className="min-w-0 flex-1 truncate text-sm font-medium">{person.name}</span>
          {trailing}
        </span>
        {line ? <span className="block truncate text-xs text-muted-foreground">{line}</span> : null}
      </span>
    </span>
  );
}

/**
 * Who a person is, drawn like a bot row (`BotIdentity`): their picture, their name, and a muted line under it with their job title, or the
 * title of the seat they hold in the company chart. With `card`, a click opens their small profile card (department, about, contact).
 * Leave `card` off inside a label, a button or a link: the card is a button of its own.
 */
export function PersonIdentity({
  person,
  size = 32,
  sub,
  trailing,
  card = false,
  className,
}: {
  person: PersonLike;
  size?: number;
  /** Replaces the title line (for example "Assigned to"). */
  sub?: ReactNode;
  trailing?: ReactNode;
  card?: boolean;
  className?: string;
}) {
  const row = (
    <PersonRow person={person} size={size} sub={sub} trailing={trailing} className={className} />
  );
  if (!card || !person.userId) return row;
  return (
    <Dropdown
      asChild
      hover={false}
      align="start"
      aria-label={`${person.name}: profile`}
      trigger={
        // No hint: the button shows the person's name, so it has a visible label.
        <button
          type="button"
          aria-label={`${person.name}: open profile`}
          className="min-w-0 max-w-full cursor-pointer rounded-md text-left focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-ring"
        >
          {row}
        </button>
      }
    >
      <PersonCard userId={person.userId} name={person.name} />
    </Dropdown>
  );
}
