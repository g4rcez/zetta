import { queryOptions } from "@tanstack/react-query";

import { identityClient } from "@/lib/identity-client";
import { STATIC } from "@/lib/query-policy";

export const identityQueries = {
  status: () =>
    queryOptions({
      queryKey: ["identity", "status"],
      queryFn: () => identityClient.status(),
      ...STATIC,
    }),
};
