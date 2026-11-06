import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useEffect, useState } from "react";

import { Button, Checkbox } from "@/components/ui";
import { BotIdentity } from "@/components/bot-identity";
import { errorMessage, type Bot } from "../chat/chat-client";
import { Badge, ConfirmButton, Empty, list, listItem, Panel } from "../shared/ui";
import { BotPicker } from "./bot-picker";
import { SkillFiles } from "./skill-files";
import { SkillForm } from "./skill-form";
import { skillsApi, skillsQueries, type SkillWithText } from "./skills-api";

/** The person's skill library: write or paste a skill, choose which bots bring it, edit, remove. An admin can also list everyone's and remove any. */
export function MySkills({
  bots,
  userId,
  isAdmin,
  scope,
  onScope,
  onError,
}: {
  bots: Bot[];
  userId: string;
  isAdmin: boolean;
  /** Whose skills are listed: it lives in the address, so a reload or a shared link shows the same list. */
  scope: "mine" | "all";
  onScope: (scope: "mine" | "all") => void;
  onError: (m?: string) => void;
}) {
  const qc = useQueryClient();
  const [status, setStatus] = useState<string>();
  const [editing, setEditing] = useState<SkillWithText>();
  const [attaching, setAttaching] = useState<{ id: string; botIds: string[] }>();
  const botsById = new Map(bots.map((b) => [b.id, b]));
  const mine = bots.filter((b) => b.canEdit);
  const { data: skills, error: loadError } = useQuery(skillsQueries.list(scope));
  useEffect(() => {
    if (loadError) onError(errorMessage(loadError));
    // `onError` is the page's setter; the message only matters when the error changes.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [loadError]);

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
        <SkillForm
          submitLabel="Save skill"
          onSubmit={(draft) =>
            run(() => skillsApi.create(draft), "Saved. Attach it to a bot below.")
          }
        />
      </Panel>

      <Panel
        title={scope === "all" ? "Everyone's skills" : "My skills"}
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
        {skills && skills.length === 0 && (
          <Empty>No skills yet. Write one above or install one from the Marketplace.</Empty>
        )}
        <ul className={list}>
          {skills?.map((s) => {
            const owned = s.ownerUserId === userId;
            return (
              <li key={s.id} className={listItem}>
                {editing?.id === s.id ? (
                  <SkillForm
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
                      <p className="font-medium">{s.name}</p>
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
                    {s.fileCount ? <SkillFiles id={s.id} count={s.fileCount} /> : null}
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
                    {attaching?.id === s.id && (
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
                      {owned && (
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
                              void skillsApi
                                .get(s.id)
                                .then(setEditing, (e) => onError(errorMessage(e)))
                            }
                          >
                            Edit
                          </Button>
                        </>
                      )}
                      <ConfirmButton
                        label="Remove"
                        question="Remove this skill? Bots stop loading it at their next run."
                        confirmLabel="Yes, remove"
                        variant="destructive"
                        onConfirm={() => run(() => skillsApi.archive(s.id), "Removed.")}
                      />
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
