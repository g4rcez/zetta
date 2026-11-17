import { useQuery } from "@tanstack/react-query";

import { UserAvatar } from "@/components/user-avatar";
import { peopleQueries } from "./people-api";

/** One labelled line of a card. A line the person did not write is not drawn. */
function Line({ label, children }: { label: string; children: string }) {
  if (!children) return null;
  return (
    <div className="space-y-0.5">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

/**
 * The small profile card of a person: what they wrote about themselves. The lists that carry a person hold only a name, a picture and a
 * title, so the rest is read from the members list, which every page that shows the card shares (and loads only when a card opens).
 */
export function PersonCard({ userId, name }: { userId: string; name: string }) {
  const people = useQuery(peopleQueries.list());
  const person = people.data?.find((p) => p.userId === userId);
  const written = person && (person.department || person.about || person.contact);
  return (
    <section aria-label={`Profile of ${name}`} className="w-72 max-w-full space-y-3 p-3">
      <div className="flex items-center gap-3">
        <UserAvatar name={name} avatar={person?.avatar} size={40} />
        <div className="min-w-0">
          <p className="truncate text-sm font-medium">{name}</p>
          {person?.title ? (
            <p className="truncate text-xs text-muted-foreground">{person.title}</p>
          ) : null}
        </div>
      </div>
      {!person ? (
        <p role="status" className="text-sm text-muted-foreground">
          {people.isError ? "Could not load this profile." : "Loading…"}
        </p>
      ) : written ? (
        <dl className="space-y-2">
          <Line label="Department">{person.department}</Line>
          <Line label="About">{person.about}</Line>
          <Line label="Contact">{person.contact}</Line>
        </dl>
      ) : (
        <p className="text-sm text-muted-foreground">Nothing more written yet.</p>
      )}
    </section>
  );
}
