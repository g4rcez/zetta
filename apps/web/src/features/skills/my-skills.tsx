import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Checkbox, Input, Select } from "@/components/ui";
import { BotIdentity } from "@/components/bot-identity";
import { errorMessage, type Bot } from "../chat/chat-client";
import { formatSize } from "../artifacts/artifacts-api";
import { relativeTime } from "../shared/relative-time";
import { Badge, ConfirmButton, Empty, list, listItem, Panel } from "../shared/ui";
import { BotPicker } from "./bot-picker";
import { SkillFiles } from "./skill-files";
import { unzipSkill, zipSkill, ZipError, type ZipFile } from "./skill-zip";
import { SkillForm } from "./skill-form";
import { SkillHistory } from "./skill-history";
import {
  skillsApi,
  skillsQueries,
  type Skill,
  type SkillUpdate,
  type SkillWithText,
} from "./skills-api";
import type { SkillsSearch } from "./skills-search";

const toBase64 = (bytes: Uint8Array) => {
  let out = "";
  for (let i = 0; i < bytes.length; i += 0x8000)
    out += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  return btoa(out);
};
const fromBase64 = (text: string) => Uint8Array.from(atob(text), (c) => c.charCodeAt(0));
/** Gives the browser a file to save. */
function download(name: string, bytes: Uint8Array, type: string) {
  const url = URL.createObjectURL(new Blob([bytes as BlobPart], { type }));
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  URL.revokeObjectURL(url);
}

/** "Used 3 times in 30 days, last 2 days ago", "Last used 40 days ago", or "Never used". */
export function usageText(s: Pick<Skill, "uses30d" | "lastUsedAt">, now = Date.now()) {
  if (!s.lastUsedAt) return "Never used";
  const last = relativeTime(s.lastUsedAt, now);
  return s.uses30d > 0
    ? `Used ${s.uses30d} ${s.uses30d === 1 ? "time" : "times"} in 30 days, last ${last}`
    : `Not used in 30 days, last ${last}`;
}

/** The person's skill library: write or paste a skill, choose which bots bring it, edit, remove. An admin can also list everyone's and remove any. */
export function MySkills({
  bots,
  userId,
  isAdmin,
  scope,
  onScope,
  search,
  setSearch,
  onError,
}: {
  bots: Bot[];
  userId: string;
  isAdmin: boolean;
  /** Whose skills are listed: it lives in the address, so a reload or a shared link shows the same list. */
  scope: "mine" | "all";
  onScope: (scope: "mine" | "all") => void;
  /** The filters of the list, as they are in the address. */
  search: SkillsSearch;
  setSearch: (
    patch: Partial<Record<keyof SkillsSearch, string | undefined>>,
    options?: { replace?: boolean },
  ) => void;
  onError: (m?: string) => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>();
  const [editing, setEditing] = useState<SkillWithText>();
  const [attaching, setAttaching] = useState<{ id: string; botIds: string[] }>();
  const [historyOf, setHistoryOf] = useState<string>();
  // The answer of the last check against GitHub, by skill. Asking GitHub is on request, so it is not part of the address.
  const [updates, setUpdates] = useState<Map<string, SkillUpdate>>();
  const botsById = new Map(bots.map((b) => [b.id, b]));
  const mine = bots.filter((b) => b.canEdit);
  const archivedView = search.view === "archived";
  const filters = {
    find: search.find,
    source: search.source,
    sort: search.sort,
    bot: search.bot,
    view: search.view,
    use: search.use,
  };
  const { data: skills, error: loadError } = useQuery(skillsQueries.list(scope, filters));
  // The search box shows the address; typing replaces the history entry, so Back leaves the page instead of undoing each letter.
  const [find, setFind] = useState(search.find ?? "");
  useEffect(() => setFind(search.find ?? ""), [search.find]);
  const [selectedIds, setSelectedIds] = useState<string[]>([]);
  const [bulk, setBulk] = useState<{ action: "attach" | "detach"; botIds: string[] }>();
  // A selection only holds skills that are still in the list (a filter or a change may have removed some).
  const selected = selectedIds.filter((id) =>
    skills?.some((s) => s.id === id && s.ownerUserId === userId),
  );
  const filtered = Boolean(search.find || search.source || search.bot || search.use);
  useEffect(() => {
    if (loadError) onError(errorMessage(loadError));
    // `onError` is the page's setter; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError]);

  /** Saves a skill and its folder as a zip, to keep or to give to someone. */
  const exportSkill = async (id: string) => {
    const skill = await skillsApi.get(id);
    const files: ZipFile[] = [];
    for (const f of skill.files) {
      const file = await skillsApi.file(id, f.path);
      files.push({
        path: f.path,
        mode: f.mode,
        content:
          file.encoding === "base64"
            ? fromBase64(file.content)
            : new TextEncoder().encode(file.content),
      });
    }
    download(`${skill.name}.zip`, zipSkill(skill, files), "application/zip");
  };
  /** Creates a skill from a zip of its folder (SKILL.md and the files next to it). */
  const importZip = async (file: File) => {
    const folder = file.name.replace(/\.zip$/i, "");
    const parsed = unzipSkill(new Uint8Array(await file.arrayBuffer()), folder);
    if (!parsed.description)
      throw new Error("The SKILL.md in the zip needs a description: say when a bot should use it.");
    const made = await skillsApi.create({
      name: parsed.name,
      description: parsed.description,
      body: parsed.body,
    });
    for (let i = 0; i < parsed.files.length; i += 50)
      await skillsApi.putFiles(
        made.id,
        parsed.files.slice(i, i + 50).map((f) => ({
          path: f.path,
          mode: f.mode,
          encoding: "base64" as const,
          content: toBase64(f.content),
        })),
      );
  };
  const run = async (work: () => Promise<unknown>, done: string) => {
    onError();
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
    } catch (e) {
      onError(errorMessage(e));
    }
    await qc.invalidateQueries({ queryKey: ["skills", "list"] });
  };

  return (
    <div className="space-y-6">
      <Panel
        title="New skill"
        description="Write a skill, or fill it from a SKILL.md file. Then choose which of your bots bring it to their harness."
      >
        <label className="inline-block cursor-pointer text-sm underline underline-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
          Import a skill folder (.zip)
          <input
            type="file"
            accept=".zip,application/zip"
            className="sr-only"
            onChange={(e) => {
              const input = e.currentTarget;
              const picked = input.files?.[0];
              if (!picked) return;
              void run(async () => {
                try {
                  await importZip(picked);
                } catch (err) {
                  throw err instanceof ZipError ? new Error(err.message) : err;
                } finally {
                  input.value = "";
                }
              }, "Imported. Attach it to a bot below.");
            }}
          />
        </label>
        <SkillForm
          submitLabel="Save skill"
          onSubmit={(draft) =>
            run(() => skillsApi.create(draft), "Saved. Attach it to a bot below.")
          }
        />
      </Panel>

      <Panel
        title={
          archivedView ? "Removed skills" : scope === "all" ? "Everyone's skills" : "My skills"
        }
        count={skills?.length}
        description="A bot loads the skills attached to it each time it runs. Type / in its chat to ask for one."
        action={
          isAdmin && (
            <Checkbox
              checked={scope === "all"}
              onChange={(e) => onScope(e.target.checked ? "all" : "mine")}
            >
              Show every person's skills
            </Checkbox>
          )
        }
      >
        <p role="status" className="text-xs empty:hidden">
          {status}
        </p>
        <div role="search" aria-label="Filter skills" className="grid gap-2 sm:grid-cols-4">
          <Input
            title="Search"
            container="sm:col-span-2"
            value={find}
            maxLength={100}
            placeholder="name or description"
            onChange={(e) => {
              setFind(e.target.value);
              setSearch({ find: e.target.value.trim() || undefined }, { replace: true });
            }}
          />
          <Select
            title="Where from"
            required={false}
            value={search.source ?? ""}
            onChange={(e) => setSearch({ source: e.target.value || undefined }, { replace: true })}
            options={[
              { value: "", label: "Anywhere" },
              { value: "manual", label: "Written here" },
              { value: "github", label: "From GitHub" },
            ]}
          />
          <Select
            title="Order"
            required={false}
            value={search.sort ?? ""}
            onChange={(e) => setSearch({ sort: e.target.value || undefined }, { replace: true })}
            options={[
              { value: "", label: "Recently changed" },
              { value: "name", label: "Name" },
              { value: "used", label: "Recently used" },
              { value: "size", label: "Largest" },
            ]}
          />
          <Select
            title="Bot"
            container="sm:col-span-2"
            required={false}
            value={search.bot ?? ""}
            onChange={(e) => setSearch({ bot: e.target.value || undefined }, { replace: true })}
            options={[
              { value: "", label: "Any bot" },
              ...mine.map((b) => ({ value: b.id, label: b.name })),
            ]}
          />
          <div className="flex items-end gap-2 sm:col-span-2">
            <Button
              size="sm"
              type="button"
              variant={search.use === "unused" ? "default" : "outline"}
              aria-pressed={search.use === "unused"}
              onClick={() => setSearch({ use: search.use === "unused" ? undefined : "unused" })}
            >
              Unused
            </Button>
            <Button
              size="sm"
              type="button"
              variant={archivedView ? "default" : "outline"}
              aria-pressed={archivedView}
              onClick={() => setSearch({ view: archivedView ? undefined : "archived" })}
            >
              Removed
            </Button>
          </div>
        </div>
        {!archivedView &&
          skills?.some((s) => s.source === "github" && s.ownerUserId === userId) && (
            <div className="flex flex-wrap items-center gap-2">
              <Button
                size="sm"
                variant="outline"
                type="button"
                onClick={() =>
                  void run(async () => {
                    const found = await skillsApi.updates();
                    setUpdates(new Map(found.map((u) => [u.id, u])));
                  }, "Checked GitHub.")
                }
              >
                Check GitHub for updates
              </Button>
              {updates && (
                <p className="text-xs text-muted-foreground">
                  {[...updates.values()].filter((u) => u.state === "update").length} with a newer
                  version.
                  {[...updates.values()].some((u) => u.state === "unknown") &&
                    " GitHub did not answer for some of them. Try again in a few minutes."}
                </p>
              )}
            </div>
          )}
        {!archivedView && skills && skills.some((s) => s.ownerUserId === userId) && (
          <div className="flex flex-wrap items-center gap-3 text-sm">
            <Checkbox
              aria-label="Select all"
              checked={
                selected.length > 0 &&
                selected.length === skills.filter((s) => s.ownerUserId === userId).length
              }
              onChange={(e) =>
                setSelectedIds(
                  e.target.checked
                    ? skills.filter((s) => s.ownerUserId === userId).map((s) => s.id)
                    : [],
                )
              }
            >
              {selected.length ? `${selected.length} selected` : "Select all"}
            </Checkbox>
            {selected.length > 0 && (
              <>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setBulk({ action: "attach", botIds: [] })}
                >
                  Give to bots
                </Button>
                <Button
                  size="sm"
                  variant="outline"
                  type="button"
                  onClick={() => setBulk({ action: "detach", botIds: [] })}
                >
                  Take from bots
                </Button>
                <ConfirmButton
                  label="Remove"
                  question={`Remove ${selected.length} skill${selected.length === 1 ? "" : "s"}? Bots stop loading them at their next run.`}
                  confirmLabel="Yes, remove"
                  variant="destructive"
                  onConfirm={() =>
                    run(async () => {
                      await skillsApi.bulk({ action: "archive", skillIds: selected });
                      setSelectedIds([]);
                    }, `Removed ${selected.length}.`)
                  }
                />
              </>
            )}
          </div>
        )}
        {bulk && selected.length > 0 && (
          <div className="space-y-2 rounded-md border p-3">
            <p className="text-sm">
              {bulk.action === "attach" ? "Give" : "Take"} {selected.length} skill
              {selected.length === 1 ? "" : "s"} {bulk.action === "attach" ? "to" : "from"}:
            </p>
            <BotPicker
              bots={mine}
              selected={bulk.botIds}
              onChange={(botIds) => setBulk({ action: bulk.action, botIds })}
            />
            <div className="flex gap-2">
              <Button
                size="sm"
                type="button"
                disabled={bulk.botIds.length === 0}
                onClick={() =>
                  void run(
                    async () => {
                      const r = await skillsApi.bulk({
                        action: bulk.action,
                        skillIds: selected,
                        botIds: bulk.botIds,
                      });
                      setBulk(undefined);
                      if (r.skippedBots.length)
                        onError(
                          `${r.skippedBots.map((id) => botsById.get(id)?.name ?? "A bot").join(", ")} already has the most skills a bot can bring, so it was left out.`,
                        );
                    },
                    bulk.action === "attach"
                      ? "Done. The bots load them at their next run."
                      : "Done.",
                  )
                }
              >
                Apply
              </Button>
              <Button size="sm" type="button" variant="outline" onClick={() => setBulk(undefined)}>
                Cancel
              </Button>
            </div>
          </div>
        )}
        {skills && skills.length === 0 && (
          <Empty>
            {archivedView
              ? "Nothing was removed."
              : filtered
                ? "No skill matches these filters."
                : "No skills yet. Write one above or install one from the Marketplace."}
          </Empty>
        )}
        <ul className={list}>
          {skills?.map((s) => {
            const owned = s.ownerUserId === userId;
            return (
              <li key={s.id} className={listItem}>
                {editing?.id === s.id ? (
                  <SkillForm
                    skillId={s.id}
                    initial={{
                      name: editing.name,
                      description: editing.description,
                      body: editing.body,
                    }}
                    submitLabel="Save"
                    onCancel={() => setEditing(undefined)}
                    onSubmit={(draft) =>
                      run(async () => {
                        await skillsApi.update(s.id, editing.version, draft);
                        setEditing(undefined);
                      }, "Updated. Every bot that uses it loads the new text at its next run.")
                    }
                  />
                ) : (
                  <div className="space-y-2">
                    <div className="flex flex-wrap items-center justify-between gap-2">
                      <div className="flex items-center gap-2">
                        {owned && !archivedView && (
                          <Checkbox
                            aria-label={`Select ${s.name}`}
                            checked={selected.includes(s.id)}
                            onChange={(e) =>
                              setSelectedIds(
                                e.target.checked
                                  ? [...selected, s.id]
                                  : selected.filter((id) => id !== s.id),
                              )
                            }
                          />
                        )}
                        <p className="font-medium">{s.name}</p>
                      </div>
                      <div className="flex items-center gap-1.5">
                        {s.source === "github" && s.sourceRepo && (
                          <a
                            href={`https://github.com/${s.sourceRepo}`}
                            target="_blank"
                            rel="noopener noreferrer"
                            className="text-xs underline"
                          >
                            {s.sourceRepo}
                          </a>
                        )}
                        <Badge>{s.source === "github" ? "From GitHub" : "Written here"}</Badge>
                        {!owned && <Badge tone="info">{s.ownerName}</Badge>}
                      </div>
                    </div>
                    <p className="text-muted-foreground">{s.description}</p>
                    <p className="text-xs text-muted-foreground">
                      {formatSize(s.bodyBytes)} · {usageText(s)}
                    </p>
                    {updates?.get(s.id)?.state === "gone" && (
                      <p className="text-xs text-warn">It is no longer on GitHub.</p>
                    )}
                    {updates?.get(s.id)?.state === "update" && (
                      <div className="flex flex-wrap items-center gap-2 text-xs">
                        <Badge tone="info">Newer version on GitHub</Badge>
                        {updates.get(s.id)!.edited ? (
                          <ConfirmButton
                            label="Update"
                            question="You changed this skill after installing it. Updating replaces your changes (they stay in its history)."
                            confirmLabel="Yes, update"
                            variant="outline"
                            onConfirm={() =>
                              run(async () => {
                                await skillsApi.updateFromSource(
                                  s.id,
                                  updates.get(s.id)!.latestRef,
                                  true,
                                );
                                setUpdates(undefined);
                              }, "Updated. Your old text is in the history.")
                            }
                          />
                        ) : (
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() =>
                              void run(async () => {
                                await skillsApi.updateFromSource(
                                  s.id,
                                  updates.get(s.id)!.latestRef,
                                  false,
                                );
                                setUpdates(undefined);
                              }, "Updated. Every bot that uses it loads the new text at its next run.")
                            }
                          >
                            Update
                          </Button>
                        )}
                      </div>
                    )}
                    {s.fileCount || (owned && !archivedView) ? (
                      <SkillFiles
                        id={s.id}
                        count={s.fileCount ?? 0}
                        owned={owned && !archivedView}
                        onChanged={() =>
                          setStatus("Saved. The bots that use it load the files at their next run.")
                        }
                      />
                    ) : null}
                    {s.filesStatus === "pending" && (
                      <p className="text-xs text-muted-foreground">
                        Its other files are not downloaded from GitHub yet.
                      </p>
                    )}
                    <div className="flex flex-wrap items-center gap-3">
                      {s.botIds.length === 0 ? (
                        <p className="text-xs text-muted-foreground">No bot uses it yet.</p>
                      ) : (
                        s.botIds.map((id) => {
                          const b = botsById.get(id);
                          return b ? <BotIdentity key={id} bot={b} size={20} /> : null;
                        })
                      )}
                    </div>
                    {historyOf === s.id && !archivedView && (
                      <SkillHistory
                        skillId={s.id}
                        onChanged={() =>
                          setStatus(
                            "Put back. Every bot that uses it loads that text at its next run.",
                          )
                        }
                      />
                    )}
                    {attaching?.id === s.id && !archivedView && (
                      <div className="space-y-2 rounded-md border p-3">
                        <BotPicker
                          bots={mine}
                          selected={attaching.botIds}
                          onChange={(botIds) => setAttaching({ id: s.id, botIds })}
                        />
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            type="button"
                            onClick={() =>
                              void run(async () => {
                                await skillsApi.setBots(s.id, attaching.botIds);
                                setAttaching(undefined);
                              }, "Saved. The bots load it at their next run.")
                            }
                          >
                            Save bots
                          </Button>
                          <Button
                            size="sm"
                            type="button"
                            variant="outline"
                            onClick={() => setAttaching(undefined)}
                          >
                            Cancel
                          </Button>
                        </div>
                      </div>
                    )}
                    <div className="flex flex-wrap items-center gap-2 pt-1">
                      {archivedView && owned && (
                        <Button
                          size="sm"
                          variant="outline"
                          type="button"
                          onClick={() =>
                            void run(
                              () => skillsApi.restore(s.id),
                              "Restored. The bots that had it load it again.",
                            )
                          }
                        >
                          Restore
                        </Button>
                      )}
                      {owned && !archivedView && (
                        <>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() => setAttaching({ id: s.id, botIds: s.botIds })}
                          >
                            Bots
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() =>
                              void exportSkill(s.id).catch((err) => onError(errorMessage(err)))
                            }
                          >
                            Export
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            aria-pressed={historyOf === s.id}
                            onClick={() => setHistoryOf(historyOf === s.id ? undefined : s.id)}
                          >
                            History
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            type="button"
                            onClick={() =>
                              void skillsApi
                                .get(s.id)
                                .then(setEditing, (e) => onError(errorMessage(e)))
                            }
                          >
                            Edit
                          </Button>
                        </>
                      )}
                      {!archivedView && (
                        <ConfirmButton
                          label="Remove"
                          question="Remove this skill? Bots stop loading it at their next run."
                          confirmLabel="Yes, remove"
                          variant="destructive"
                          onConfirm={() => run(() => skillsApi.archive(s.id), "Removed.")}
                        />
                      )}
                    </div>
                  </div>
                )}
              </li>
            );
          })}
        </ul>
      </Panel>
    </div>
  );
}
