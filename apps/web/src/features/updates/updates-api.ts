import { queryOptions, useQuery } from "@tanstack/react-query";
import {
  dayOf,
  type BuildInfo,
  type UpdateChange,
  type UpdateCheckMode,
  type UpdateState,
} from "@zetta/core/update-check";

import { STATIC } from "@/lib/query-policy";
import { call } from "../chat/chat-client";
import { identityQueries } from "../identity/identity-queries";
import { isRootIdentity } from "@/lib/identity-client";

/** What `GET /api/installation/version` answers: the build of this server and what the daily update check knows. */
export type VersionStatus = {
  build: BuildInfo | null;
  state: UpdateState;
  /** The newest day the published changelog lists. */
  latest: { date: string } | null;
  /** The changes newer than this build, newest first, at most 30. */
  changes: UpdateChange[];
  /** When the changelog was last read, or null. */
  checkedAt: string | null;
  /** `off`: the administrator or the operator turned the check off, so nothing is checked. */
  check: UpdateCheckMode;
};

export const updatesApi = {
  version: () => call<VersionStatus>("/api/installation/version"),
};

export const updatesQueries = {
  /** Under the `installation` key: saving the installation settings refreshes it too. */
  version: () =>
    queryOptions({
      queryKey: ["installation", "version"],
      queryFn: updatesApi.version,
      ...STATIC,
    }),
};

/** The version line of a build: "Version 54121d6 · 2026-11-10", or "Version unknown" when the build carries no stamp. */
export function versionText(build: BuildInfo | null): string {
  if (!build) return "Version unknown";
  return `Version ${build.commit.slice(0, 7)} · ${dayOf(build.date) ?? build.date}`;
}

/** True for the person who runs this server (root): updating it is theirs. Everyone else, and the time before the answer, are false. */
export function useIsAdmin(): boolean {
  const { data } = useQuery(identityQueries.status());
  return isRootIdentity(data);
}

/**
 * What the update check knows, for the administrator only: a member never asks and sees nothing. `undefined` while it loads, for a member
 * and when the server cannot answer.
 */
export function useUpdateStatus(): VersionStatus | undefined {
  const admin = useIsAdmin();
  const { data } = useQuery({ ...updatesQueries.version(), enabled: admin });
  return admin ? data : undefined;
}
