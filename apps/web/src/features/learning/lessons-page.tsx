import { LightbulbIcon } from "@phosphor-icons/react";
import { Alert } from "@g4rcez/components/alert";
import { useQuery, useQueryClient } from "@tanstack/react-query";
import { Link } from "@tanstack/react-router";
import { useEffect, useMemo, useState } from "react";

import { BotSelect } from "@/components/bot-select";
import { Button, Checkbox, Input, Select } from "@/components/ui";
import { errorMessage, type Bot } from "../chat/chat-client";
import { chatQueries } from "../chat/chat-queries";
import { relativeTime } from "../shared/relative-time";
import { Badge, ConfirmButton, Empty, list, listItem, Panel } from "../shared/ui";
import {
  learningApi,
  learningQueries,
  type ItemRef,
  type UsefulnessLabel,
  type UsefulnessRow,
} from "./learning-api";
import { FindingsPanel, WeeklyCheck } from "./findings-panel";
import type { LessonsSearch } from "./lessons-search";

type SetSearch = (
  patch: Partial<Record<keyof LessonsSearch, string | undefined>>,
  options?: { replace?: boolean },
) => void;

const NONE: Bot[] = [];
const LABELS: UsefulnessLabel[] = ["hurts", "unused", "unclear", "helps"];
const LABEL_TEXT: Record<UsefulnessLabel, string> = {
  hurts: "Hurts",
  unused: "Unused",
  unclear: "Unclear",
  helps: "Helps",
};
const LABEL_TONE = {
  hurts: "danger",
  unused: "neutral",
  unclear: "info",
  helps: "success",
} as const;
const refOf = (r: Pick<UsefulnessRow, "kind" | "id">): ItemRef => ({ kind: r.kind, id: r.id });
const keyOf = (r: Pick<UsefulnessRow, "kind" | "id">) => `${r.kind}:${r.id}`;
const percent = (n: number) => `${Math.round(n * 100)}%`;

function ItemLink({ row }: { row: UsefulnessRow }) {
  return row.kind === "memory" ? (
    <Link to="/memory/$slug" params={{ slug: row.slug }} className="font-medium hover:underline">
      {row.title}
    </Link>
  ) : (
    <Link to="/skills" search={{ find: row.slug }} className="font-medium hover:underline">
      {row.title}
    </Link>
  );
}

function UsefulnessItem({
  row,
  selected,
  onSelect,
}: {
  row: UsefulnessRow;
  selected: boolean;
  onSelect: (on: boolean) => void;
}) {
  return (
    <li className={listItem}>
      <div className="space-y-1.5">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div className="flex min-w-0 items-center gap-2">
            <Checkbox
              aria-label={`Select ${row.title}`}
              checked={selected}
              onChange={(e) => onSelect(e.target.checked)}
            />
            <ItemLink row={row} />
          </div>
          <div className="flex items-center gap-1.5">
            <Badge>{row.kind === "memory" ? "Memory" : "Skill"}</Badge>
            <Badge tone={LABEL_TONE[row.label]}>{LABEL_TEXT[row.label]}</Badge>
          </div>
        </div>
        {row.howto && <p className="text-muted-foreground">{row.howto}</p>}
        <p className="text-xs text-pretty">{row.reason}</p>
        <p className="text-xs text-muted-foreground">
          {row.uses === 0
            ? "No use counted"
            : `${row.uses} ${row.uses === 1 ? "use" : "uses"}: ${row.good} went well, ${row.bad} needed the person to step in`}
          {row.lastUsedAt ? ` · last used ${relativeTime(row.lastUsedAt)}` : ""}
        </p>
      </div>
    </li>
  );
}

/** Memory items and skills, ranked by what happened after the replies that used them, with bulk archive and restore. */
function UsefulnessPanel({ search, setSearch }: { search: LessonsSearch; setSearch: SetSearch }) {
  const qc = useQueryClient();
  const botsQuery = useQuery(chatQueries.bots());
  const bots = botsQuery.data ?? NONE;
  // BotSelect rebuilds its options when the list changes: keep the same array between renders.
  const mine = useMemo(() => bots.filter((b) => b.canEdit), [bots]);
  const filters = {
    find: search.find,
    label: search.label,
    kind: search.kind,
    sort: search.sort,
    bot: search.bot,
    view: search.view,
  };
  const { data, error: loadError } = useQuery(learningQueries.usefulness(filters));
  // The search box shows the address; typing replaces the history entry, so Back leaves the page instead of undoing each letter.
  const [find, setFind] = useState(search.find ?? "");
  useEffect(() => setFind(search.find ?? ""), [search.find]);
  const [selectedKeys, setSelectedKeys] = useState<string[]>([]);
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const archivedView = search.view === "archived";
  const rows = data?.rows ?? [];
  // A selection only holds rows that are still in the list (a filter or a change may have removed some).
  const selected = rows.filter((r) => selectedKeys.includes(keyOf(r)));
  const filtered = Boolean(search.find || search.label || search.kind || search.bot);

  const change = async (action: "archive" | "restore") => {
    setError(undefined);
    setStatus(undefined);
    try {
      const r = await learningApi[action](selected.map(refOf));
      setSelectedKeys([]);
      setStatus(
        `${action === "archive" ? "Archived" : "Restored"} ${r.done}.${r.failed.length ? ` ${r.failed.map((f) => f.reason).join(" ")}` : ""}`,
      );
    } catch (e) {
      setError(errorMessage(e));
    }
    await qc.invalidateQueries({ queryKey: ["learning"] });
  };

  return (
    <Panel
      title={archivedView ? "Archived" : "Worth keeping?"}
      count={data?.total}
      description={
        <>
          What happened after each memory item and skill was used, over the last{" "}
          {data?.windowDays ?? 90} days: did the person have to step in?
          {data?.baselineBadRate != null &&
            ` They stepped in after ${percent(data.baselineBadRate)} of the bots' replies in general, so that is what an item is compared with.`}{" "}
          Nothing is deleted: archived items can be brought back.
        </>
      }
    >
      {(error || loadError) && <Alert theme="danger">{error ?? errorMessage(loadError)}</Alert>}
      <p role="status" className="text-xs empty:hidden">
        {status}
      </p>
      <div role="group" aria-label="Verdict" className="flex flex-wrap gap-2">
        {LABELS.map((l) => (
          <Button
            key={l}
            size="sm"
            type="button"
            variant={search.label === l ? "default" : "outline"}
            aria-pressed={search.label === l}
            onClick={() => setSearch({ label: search.label === l ? undefined : l })}
          >
            {LABEL_TEXT[l]}
            {data && !archivedView ? ` (${data.counts[l]})` : ""}
          </Button>
        ))}
      </div>
      <div role="search" aria-label="Filter lessons" className="grid gap-2 sm:grid-cols-4">
        <Input
          title="Search"
          container="sm:col-span-2"
          value={find}
          maxLength={100}
          placeholder="title, words or tag"
          onChange={(e) => {
            setFind(e.target.value);
            setSearch({ find: e.target.value.trim() || undefined }, { replace: true });
          }}
        />
        <Select
          title="Kind"
          required={false}
          value={search.kind ?? "all"}
          onChange={(e) =>
            setSearch(
              { kind: e.target.value === "all" ? undefined : e.target.value },
              { replace: true },
            )
          }
          options={[
            // Not "": the select shows nothing for an empty value. The default is left out of the address.
            { value: "all", label: "Memory and skills" },
            { value: "memory", label: "Memory items" },
            { value: "skill", label: "Skills" },
          ]}
        />
        <Select
          title="Order"
          required={false}
          value={search.sort ?? "worst"}
          onChange={(e) =>
            setSearch(
              { sort: e.target.value === "worst" ? undefined : e.target.value },
              { replace: true },
            )
          }
          options={[
            { value: "worst", label: "Worst first" },
            { value: "best", label: "Best first" },
            { value: "uses", label: "Most used" },
            { value: "recent", label: "Recently used" },
            { value: "name", label: "Name" },
          ]}
        />
        <div className="sm:col-span-3">
          <BotSelect
            label="Bot"
            placeholder="Any bot"
            bots={mine}
            value={search.bot ?? ""}
            onChange={(botId) => setSearch({ bot: botId || undefined }, { replace: true })}
          />
        </div>
        <div className="flex items-end">
          <Button
            size="sm"
            type="button"
            variant={archivedView ? "default" : "outline"}
            aria-pressed={archivedView}
            onClick={() => setSearch({ view: archivedView ? undefined : "archived" })}
          >
            Archived
          </Button>
        </div>
      </div>
      {rows.length > 0 && (
        <div className="flex flex-wrap items-center gap-3 text-sm">
          <Checkbox
            aria-label="Select all"
            checked={selected.length > 0 && selected.length === rows.length}
            onChange={(e) => setSelectedKeys(e.target.checked ? rows.map(keyOf) : [])}
          >
            {selected.length ? `${selected.length} selected` : "Select all"}
          </Checkbox>
          {selected.length > 0 &&
            (archivedView ? (
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() => void change("restore")}
              >
                Bring back
              </Button>
            ) : (
              <ConfirmButton
                label="Archive"
                question={`Archive ${selected.length} ${selected.length === 1 ? "item" : "items"}? Bots stop using them. You can bring them back from Archived.`}
                confirmLabel="Yes, archive"
                variant="destructive"
                onConfirm={() => change("archive")}
              />
            ))}
        </div>
      )}
      {data && rows.length === 0 && (
        <Empty>
          {archivedView
            ? "Nothing is archived."
            : filtered
              ? "Nothing matches these filters."
              : "Nothing to rank yet. Once your bots use memory items and skills, they appear here."}
        </Empty>
      )}
      <ul className={list}>
        {rows.map((r) => (
          <UsefulnessItem
            key={keyOf(r)}
            row={r}
            selected={selectedKeys.includes(keyOf(r))}
            onSelect={(on) =>
              setSelectedKeys(
                on ? [...selectedKeys, keyOf(r)] : selectedKeys.filter((k) => k !== keyOf(r)),
              )
            }
          />
        ))}
      </ul>
      {data && data.total > rows.length && (
        <p className="text-xs text-muted-foreground">
          Showing the first {rows.length} of {data.total}. Narrow the list with the filters.
        </p>
      )}
    </Panel>
  );
}

/** What the bots learned and which of it is worth keeping, and what the weekly tidy-up suggests. */
export function LessonsPage({
  search,
  setSearch,
}: {
  search: LessonsSearch;
  setSearch: SetSearch;
}) {
  const suggestions = search.tab === "suggestions";
  const open = useQuery(learningQueries.findings("open"));
  return (
    <div className="h-full overflow-y-auto">
      <div className="mx-auto w-full max-w-6xl min-w-0 space-y-6 p-4 md:p-8">
        <header className="flex items-start gap-3 border-b pb-5">
          <span
            aria-hidden="true"
            className="grid size-10 shrink-0 place-items-center rounded-lg bg-primary/10 text-primary"
          >
            <LightbulbIcon className="size-5" />
          </span>
          <div className="min-w-0">
            <h1 className="flex items-center gap-2 text-2xl text-balance">Lessons</h1>
            <p className="text-sm text-pretty text-muted-foreground">
              Which of what your bots know is worth keeping. Each memory item and skill is read
              against what happened after it was used.
            </p>
          </div>
        </header>
        <div role="group" aria-label="Lessons" className="flex gap-1">
          <Button
            size="sm"
            type="button"
            variant={suggestions ? "outline" : "default"}
            aria-pressed={!suggestions}
            onClick={() => setSearch({ tab: undefined })}
          >
            Worth keeping
          </Button>
          <Button
            size="sm"
            type="button"
            variant={suggestions ? "default" : "outline"}
            aria-pressed={suggestions}
            onClick={() => setSearch({ tab: "suggestions" })}
          >
            Suggestions{open.data?.length ? ` (${open.data.length})` : ""}
          </Button>
        </div>
        {suggestions ? (
          <FindingsPanel />
        ) : (
          <UsefulnessPanel search={search} setSearch={setSearch} />
        )}
        <WeeklyCheck />
      </div>
    </div>
  );
}
