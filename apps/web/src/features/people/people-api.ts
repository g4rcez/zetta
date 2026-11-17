import { queryOptions } from "@tanstack/react-query";
import type { AvatarValue } from "@zetta/core/avatar";

import { call } from "../chat/chat-client";

/**
 * A member as other members see them: the lines they wrote about themselves, never an email. `title` is what to show under the name: the
 * job title, else the title of their seat in the company chart, else empty.
 */
export type Person = {
  userId: string;
  name: string;
  avatar: AvatarValue | null;
  jobTitle: string;
  title: string;
  department: string;
  about: string;
  contact: string;
};

export const peopleApi = {
  list: (q = "") =>
    call<{ people: Person[] }>(`/api/people${q ? `?q=${encodeURIComponent(q)}` : ""}`).then(
      (r) => r.people,
    ),
};

export const peopleQueries = {
  /** Members, narrowed by `q` (name, title or department). Every key starts with "people": one invalidation refreshes them all. */
  list: (q = "") => queryOptions({ queryKey: ["people", q], queryFn: () => peopleApi.list(q) }),
};
