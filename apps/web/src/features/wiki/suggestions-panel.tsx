import { useQuery } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";

import { Button } from "@/components/ui";
import { call } from "../chat/chat-client";
import { Badge, list, listItem } from "../shared/ui";
import { RailSection } from "./rail-section";
import { useAction } from "./use-action";
import { wikiQueries } from "./wiki-api";

export function SuggestionsPanel() {
  const { data } = useQuery(wikiQueries.suggestions());
  const { run, feedback } = useAction();
  if (!data || (!data.incoming.length && !data.outgoing.length)) return null;
  return (
    <RailSection
      title="Suggestions"
      label="Memory suggestions"
      count={data.incoming.length}
      description="Changes other members suggested for items you shared, and the ones you sent."
    >
      {data.incoming.length > 0 && (
        <ul className={list} aria-label="Suggestions for your items">
          {data.incoming.map((s) => (
            <li key={s.id} className={`${listItem} space-y-2`}>
              <p>
                <span className="font-medium">{s.authorName}</span> suggests a change to{" "}
                <Link
                  to="/memory/$slug"
                  params={{ slug: s.slug }}
                  className="font-medium hover:underline"
                >
                  {s.pageTitle}
                </Link>
                {s.baseVersion !== s.pageVersion && (
                  <span className="ml-2">
                    <Badge tone="warning">Written for an older version</Badge>
                  </span>
                )}
              </p>
              {s.reason && <p className="text-muted-foreground">Why: {s.reason}</p>}
              <div className="grid gap-2 md:grid-cols-2">
                <div>
                  <p className="text-xs text-muted-foreground">Now</p>
                  <p className="whitespace-pre-wrap break-words">{s.currentContent}</p>
                </div>
                <div>
                  <p className="text-xs text-muted-foreground">Suggested</p>
                  <p className="whitespace-pre-wrap break-words">{s.content}</p>
                </div>
              </div>
              <div className="flex gap-2">
                <Button
                  size="xs"
                  onClick={() =>
                    void run(
                      () =>
                        call(`/api/wiki-suggestions/${s.id}/decision`, "POST", {
                          decision: "accept",
                        }),
                      "Accepted: the item has a new version.",
                    )
                  }
                >
                  Accept
                </Button>
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void run(
                      () =>
                        call(`/api/wiki-suggestions/${s.id}/decision`, "POST", {
                          decision: "reject",
                        }),
                      "Rejected.",
                    )
                  }
                >
                  Reject
                </Button>
              </div>
            </li>
          ))}
        </ul>
      )}
      {data.outgoing.length > 0 && (
        <ul className={list} aria-label="Your suggestions">
          {data.outgoing.map((s) => (
            <li
              key={s.id}
              className={`${listItem} flex flex-wrap items-center justify-between gap-2`}
            >
              <span>
                Your suggestion for {s.pageTitle} ·{" "}
                <Badge
                  tone={
                    s.status === "accepted" ? "success" : s.status === "open" ? "info" : "neutral"
                  }
                >
                  {s.status}
                </Badge>
              </span>
              {s.status === "open" && (
                <Button
                  size="xs"
                  variant="outline"
                  onClick={() =>
                    void run(() => call(`/api/wiki-suggestions/${s.id}`, "DELETE"), "Withdrawn.")
                  }
                >
                  Withdraw
                </Button>
              )}
            </li>
          ))}
        </ul>
      )}
      {feedback}
    </RailSection>
  );
}
