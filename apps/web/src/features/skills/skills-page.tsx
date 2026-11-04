import { LightningIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useQuery } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { Marketplace } from "./marketplace";
import { MySkills } from "./my-skills";
import type { SkillsSearch } from "./skills-search";

const NONE: Bot[] = [];
type Tab = "mine" | "market";
const TABS: { id: Tab; label: string }[] = [
  { id: "mine", label: "My skills" },
  { id: "market", label: "Marketplace" },
];

/** Skills a bot brings to its harness: a personal library, plus a marketplace to install more from GitHub. */
export function SkillsPage({
  userId,
  isAdmin,
  search,
  setSearch,
}: {
  userId: string;
  isAdmin: boolean;
  /** The view, as it is in the address. */
  search: SkillsSearch;
  setSearch: (
    patch: Partial<Record<keyof SkillsSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
}) {
  const tab: Tab = search.tab ?? "mine";
  const botsQuery = useQuery(chatQueries.bots());
  const bots = botsQuery.data ?? NONE;
  const [error, setError] = useState<string>();
  useEffect(() => {
    if (botsQuery.error) setError(errorMessage(botsQuery.error));
  }, [botsQuery.error]);
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <LightningIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="text-2xl text-balance">Skills</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Give each bot the skills it needs, to build specialized bots. Write them here or
              install them from GitHub.
            </p>
          </div>
        </header>
        <div role="group" aria-label="Skills" className="flex gap-1">
          {TABS.map((t) => (
            <Button
              key={t.id}
              size="sm"
              variant={tab === t.id ? "default" : "outline"}
              aria-pressed={tab === t.id}
              onClick={() => setSearch({ tab: t.id === "market" ? "market" : undefined })}
            >
              {t.label}
            </Button>
          ))}
        </div>
        {error && <Alert theme="danger">{error}</Alert>}
        {tab === "mine" ? (
          <MySkills
            bots={bots}
            userId={userId}
            isAdmin={isAdmin}
            scope={search.scope === "all" ? "all" : "mine"}
            onScope={(scope) => setSearch({ scope: scope === "all" ? "all" : undefined })}
            onError={setError}
          />
        ) : (
          <Marketplace
            bots={bots}
            q={search.q}
            filter={search.filter ?? ""}
            onQuery={(q) => setSearch({ q, filter: undefined })}
            onFilter={(filter) => setSearch({ filter }, { replace: true })}
            onError={setError}
          />
        )}
      </div>
    </div>
  );
}
