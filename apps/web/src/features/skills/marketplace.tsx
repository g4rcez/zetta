import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useMemo, useState, type FormEvent } from "react";

import { Button, Input } from "@/components/ui";
import { formatSize } from "../artifacts/artifacts-api";
import { errorMessage, type Bot } from "../chat/chat-client";
import { Badge, Panel } from "../shared/ui";
import { BotPicker } from "./bot-picker";
import { looksLikeSource } from "./source";
import { SkillPicker, type PickerItem } from "./skill-picker";
import {
  TRUST_LABEL,
  FAILURE_TEXT,
  skillsApi,
  skillsQueries,
  WARNING_TEXT,
  type MarketAnswer,
  type MarketRepo,
  type SearchResult,
  type Trust,
} from "./skills-api";

/** A skill as one row: the key holds the repository too, so skills of several repositories can be chosen together. */
const keyOf = (repo: string, path: string) => `${repo}::${path}`;

type Shown = {
  title: string;
  trust: Trust | null | undefined;
  note?: string;
  rows: {
    repo: string;
    ref: string;
    name: string;
    path: string;
    description: string;
    warnings: string[];
    files: { count: number; bytes: number };
    installed: boolean;
    showRepo: boolean;
  }[];
};

const fromRepo = (r: MarketRepo): Shown => ({
  title: r.repo,
  trust: r.trust,
  ...(r.truncated ? { note: "The repository is large: some skills may not be listed." } : {}),
  rows: r.skills.map((k) => ({
    ...k,
    repo: r.repo,
    ref: r.ref,
    installed: k.installedId !== null,
    showRepo: false,
  })),
});
const fromSearch = (text: string, r: SearchResult): Shown => ({
  title: `Results for "${text}"`,
  trust: undefined,
  note:
    [
      r.indexing ? "Still reading the repositories: search again in a moment for more." : "",
      r.unavailable.length ? `Could not read: ${r.unavailable.join(", ")}.` : "",
    ]
      .filter(Boolean)
      .join(" ") || undefined,
  rows: r.skills.map((k) => ({ ...k, installed: k.installedId !== null, showRepo: true })),
});

const shownOf = (a: MarketAnswer): Shown =>
  a.kind === "repo" ? fromRepo(a.repo) : fromSearch(a.text, a.result);

/** Find skills in the trusted repositories, or browse any GitHub repository, choose some, and install them into the library. */
export function Marketplace({
  bots,
  q,
  filter,
  onQuery,
  onFilter,
  onError,
}: {
  bots: Bot[];
  /** What was searched. It lives in the address: the results below are read from it, so a reload or a shared link shows them again. */
  q: string | undefined;
  filter: string;
  onQuery: (q: string | undefined) => void;
  onFilter: (text: string) => void;
  onError: (m?: string) => void;
}) {
  const qc = useQueryClient();
  /** The text in the box before it is submitted; the submitted text is `q`. */
  const [draft, setDraft] = useState(q ?? "");
  const [selected, setSelected] = useState<string[]>([]);
  const [picked, setPicked] = useState<string[]>([]);
  const [installing, setInstalling] = useState(false);
  const [status, setStatus] = useState<string>();
  const mine = bots.filter((b) => b.canEdit);

  const suggested = useQuery(skillsQueries.suggestions());
  const suggestions = suggested.data;
  useEffect(() => {
    if (suggested.error) onError(errorMessage(suggested.error));
    // `onError` is the page's setter; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [suggested.error]);

  // The address is the real state: the results follow `q`, also after Back, Forward, a reload or a shared link.
  const market = useQuery({ ...skillsQueries.market(q ?? ""), enabled: Boolean(q) });
  const answer = market.data;
  const shown = useMemo(
    () => (q && answer && !market.isError ? shownOf(answer) : undefined),
    [q, answer, market.isError],
  );
  const busy = installing || (Boolean(q) && market.isFetching);
  useEffect(() => {
    setDraft(q ?? "");
    setSelected([]);
    setStatus(undefined);
    if (q) onError();
    // `onError` is the page's setter; the results only start over when the address changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [q]);
  useEffect(() => {
    if (market.error) onError(errorMessage(market.error));
    // `onError` is the page's setter; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [market.error]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    const text = draft.trim();
    if (!text) return;
    // The same text again reads it again, since the address does not change.
    if (text === q) {
      onError();
      setStatus(undefined);
      void market.refetch();
    } else onQuery(text);
  };

  const install = async () => {
    if (!shown) return;
    onError();
    setInstalling(true);
    try {
      const groups = new Map<string, { ref: string; paths: string[] }>();
      for (const r of shown.rows)
        if (selected.includes(keyOf(r.repo, r.path)))
          groups.set(r.repo, { ref: r.ref, paths: [...(groups.get(r.repo)?.paths ?? []), r.path] });
      let installed = 0;
      let attached = 0;
      const failed: string[] = [];
      let attachError: string | null = null;
      for (const [repo, g] of groups) {
        const res = await skillsApi.install({
          source: repo,
          sha: g.ref,
          paths: g.paths,
          botIds: picked,
        });
        installed += res.installed.length;
        attached += res.attached.length;
        attachError ??= res.attachError;
        for (const f of res.failed)
          failed.push(
            `${f.path.split("/").slice(-2, -1)[0] ?? f.path} ${FAILURE_TEXT[f.code] ?? f.code}`,
          );
      }
      const message = [
        installed ? `Installed ${installed} ${installed === 1 ? "skill" : "skills"}.` : "",
        attached
          ? `Brought ${attached} ${attached === 1 ? "skill" : "skills"} that you already had to the chosen bots.`
          : "",
        !installed && !attached ? "Nothing was installed." : "",
        installed && !picked.length ? "Attach them to a bot from My skills." : "",
        attachError
          ? `The bots could not take them (${attachError}); attach them from My skills.`
          : "",
        failed.length ? `Not installed: ${failed.join("; ")}.` : "",
      ]
        .filter(Boolean)
        .join(" ");
      // The list is read again so the installed ones are marked; reading it clears the status, so the message is set after.
      await Promise.all([
        qc.invalidateQueries({ queryKey: ["skills", "market", "source"] }),
        qc.invalidateQueries({ queryKey: ["skills", "list"] }),
      ]);
      setStatus(message);
      setSelected([]);
    } catch (e) {
      onError(errorMessage(e));
    } finally {
      setInstalling(false);
    }
  };

  // Skills that are already installed can be chosen too, to bring them to more bots: with only those chosen, a bot has to be picked.
  const onlyInstalled =
    selected.length > 0 &&
    (shown?.rows ?? [])
      .filter((r) => selected.includes(keyOf(r.repo, r.path)))
      .every((r) => r.installed);
  const items: PickerItem[] = (shown?.rows ?? []).map((r) => ({
    key: keyOf(r.repo, r.path),
    name: r.name,
    description: r.description,
    repo: r.showRepo ? r.repo : undefined,
    meta: r.files.count
      ? `${r.files.count} ${r.files.count === 1 ? "file" : "files"} · ${formatSize(r.files.bytes)}`
      : undefined,
    href: `https://github.com/${r.repo}/blob/${r.ref}/${r.path}`,
    installed: r.installed,
    blocked: r.warnings[0] ? WARNING_TEXT[r.warnings[0] as keyof typeof WARNING_TEXT] : undefined,
  }));

  return (
    <div className="space-y-6">
      <Panel
        title="Find skills"
        description={
          <>
            Search the trusted repositories by name, or paste a GitHub repository (
            <code>owner/repo</code>) or a link from GitHub or{" "}
            <a
              href="https://skills.sh"
              target="_blank"
              rel="noopener noreferrer"
              className="underline"
            >
              skills.sh
            </a>
            . Nothing is installed until you choose it.
          </>
        }
      >
        <form onSubmit={submit} className="flex flex-wrap items-end gap-2">
          <Input
            title="Search skills or paste a repository"
            hiddenLabel
            container="min-w-64 flex-1"
            value={draft}
            onChange={(e) => setDraft(e.target.value)}
            placeholder="interview-me, or anthropics/skills"
          />
          <Button type="submit" size="sm" disabled={busy || !draft.trim()}>
            {looksLikeSource(draft) ? "Browse" : "Search"}
          </Button>
        </form>
        <ul
          aria-label="Suggested repositories"
          className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3"
        >
          {suggestions?.map((f) => (
            <li key={f.repo}>
              <button
                type="button"
                onClick={() => {
                  onQuery(f.repo);
                }}
                className="w-full rounded-lg border bg-card p-3 text-left text-sm hover:bg-muted"
              >
                <span className="flex items-center justify-between gap-2">
                  <span className="font-medium">{f.repo}</span>
                  <Badge tone="success">{TRUST_LABEL[f.trust]}</Badge>
                </span>
                <span className="block text-xs text-muted-foreground">{f.blurb}</span>
              </button>
            </li>
          ))}
        </ul>
      </Panel>

      {(shown || busy) && (
        <Panel
          title={shown?.title ?? "Loading…"}
          description={
            shown?.trust === null ? (
              <Badge tone="warning">Not on the trusted list</Badge>
            ) : shown?.trust ? (
              <Badge tone="success">{TRUST_LABEL[shown.trust]}</Badge>
            ) : undefined
          }
        >
          <p role="status" className="text-xs empty:hidden">
            {status}
          </p>
          {shown?.note && <p className="text-xs text-muted-foreground">{shown.note}</p>}
          {shown && shown.rows.length === 0 ? (
            <p className="text-sm text-muted-foreground">Nothing found.</p>
          ) : (
            shown && (
              <SkillPicker
                items={items}
                selected={selected}
                onChange={setSelected}
                filter={filter}
                onFilter={onFilter}
              />
            )
          )}
          <p className="text-sm font-medium">Bring them to these bots (optional)</p>
          <BotPicker bots={mine} selected={picked} onChange={setPicked} />
          <p className="text-xs text-muted-foreground">
            Bots follow a skill's instructions, so only install ones you trust.
          </p>
          <Button
            type="button"
            size="sm"
            disabled={busy || selected.length === 0 || (onlyInstalled && picked.length === 0)}
            onClick={() => void install()}
          >
            {selected.length === 0
              ? "Install"
              : onlyInstalled
                ? `Add ${selected.length} ${selected.length === 1 ? "skill" : "skills"} to these bots`
                : `Install ${selected.length} ${selected.length === 1 ? "skill" : "skills"}`}
          </Button>
        </Panel>
      )}
    </div>
  );
}
