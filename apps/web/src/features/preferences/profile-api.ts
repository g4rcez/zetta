import { queryOptions, useQuery } from "@tanstack/react-query";
import type { AvatarValue } from "@zetta/core/avatar";

import { STATIC } from "@/lib/query-policy";
import { call } from "../chat/chat-client";

export type Profile = { name: string; email: string; avatar: AvatarValue | null };
export type ProfileSession = {
  id: string;
  /** `this` is the browser that asked. */
  device: "this" | "other";
  userAgent: string | null;
  ipAddress: string | null;
  createdAt: string;
};

export const profileApi = {
  get: () => call<{ profile: Profile }>("/api/profile").then((r) => r.profile),
  update: (patch: { name?: string; avatar?: AvatarValue | null }) =>
    call<{ profile: Profile }>("/api/profile", "PATCH", patch).then((r) => r.profile),
  sessions: () =>
    call<{ sessions: ProfileSession[] }>("/api/profile/sessions").then((r) => r.sessions),
};

/** Both keys start with "profile": one invalidation refreshes the person and the session list. */
export const profileQueries = {
  me: () => queryOptions({ queryKey: ["profile"], queryFn: profileApi.get, ...STATIC }),
  sessions: () => queryOptions({ queryKey: ["profile", "sessions"], queryFn: profileApi.sessions }),
};

/** The signed-in person's name, email and picture. Pass `enabled: false` while nobody is signed in. */
export const useProfile = (enabled = true) => useQuery({ ...profileQueries.me(), enabled });
