import { UserCircleIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useState } from "react";

import { PersonIdentity } from "@/components/person-identity";
import { Input } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import { Empty, list, listItem, Loading } from "../shared/ui";
import { peopleQueries, type Person } from "./people-api";
import type { PeopleSearch } from "./people-search";

/** One labelled line under a person. A line nobody wrote is not drawn. */
function Fact({ label, children }: { label: string; children: string }) {
  if (!children) return null;
  return (
    <div className="min-w-0">
      <dt className="text-xs text-muted-foreground">{label}</dt>
      <dd className="text-sm break-words whitespace-pre-wrap">{children}</dd>
    </div>
  );
}

function PersonRow({ person }: { person: Person }) {
  const facts = person.department || person.about || person.contact;
  return (
    <li className={`${listItem} space-y-2`}>
      <PersonIdentity person={person} size={36} />
      {facts ? (
        <dl className="grid gap-x-6 gap-y-2 pl-[46px] sm:grid-cols-3">
          <Fact label="Department">{person.department}</Fact>
          <Fact label="Contact">{person.contact}</Fact>
          <Fact label="About">{person.about}</Fact>
        </dl>
      ) : null}
    </li>
  );
}

/**
 * The members of this installation and what each one wrote about themselves: job title (or the title of their seat in the company chart),
 * department, contact and a short text. There is no email. What was searched lives in the address (`?q=`).
 */
export function PeoplePage({
  search,
  setSearch,
}: {
  /** The view, as it is in the address. */
  search: PeopleSearch;
  setSearch: (patch: Partial<Record<keyof PeopleSearch, string | undefined>>) => void;
}) {
  const q = search.q ?? "";
  // The box shows what is typed; the address follows it, and the list loads from the address.
  const [draft, setDraft] = useState(q);
  useEffect(() => setDraft(q), [q]);
  const people = useQuery(peopleQueries.list(q));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-4xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <UserCircleIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl text-balance">People</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Who is in this installation, and what they do. Write your own lines in{" "}
              <Link
                to="/preferences"
                hash="profile"
                className="underline underline-offset-2 hover:text-foreground"
              >
                Preferences
              </Link>
              .
            </p>
          </div>
        </header>
        <div role="search" aria-label="Find a person">
          <Input
            title="Search"
            type="search"
            required={false}
            maxLength={100}
            placeholder="name, job title or department"
            value={draft}
            onChange={(e) => {
              setDraft(e.target.value);
              setSearch({ q: e.target.value.trim() || undefined });
            }}
          />
        </div>
        {people.isError ? (
          <Alert theme="danger">{errorMessage(people.error, "Could not load the people.")}</Alert>
        ) : !people.data ? (
          <Loading />
        ) : people.data.length === 0 ? (
          <Empty>{q ? "No one matches that search." : "No one has joined yet."}</Empty>
        ) : (
          <ul aria-label="People" className={list}>
            {people.data.map((p) => (
              <PersonRow key={p.userId} person={p} />
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
