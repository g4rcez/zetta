import { useQuery, useQueryClient } from "@tanstack/react-query";
import { useState } from "react";

import { EditorField } from "@/components/editor/editor";
import { Button, Input } from "@/components/ui";
import { formatSize } from "../artifacts/artifacts-api";
import { errorMessage } from "../chat/chat-client";
import { ConfirmButton } from "../shared/ui";
import { skillsApi } from "./skills-api";

/**
 * The files next to a skill's SKILL.md (scripts, references, assets). The list is read from the server when it is opened. The owner can
 * add a text file, change one, or remove one: each change is a save in the skill's history. Files that are not text can be removed, not
 * edited here.
 */
export function SkillFiles({
  id,
  count,
  owned = false,
  onChanged,
}: {
  id: string;
  count: number;
  /** The owner may change the folder. */
  owned?: boolean;
  onChanged?: () => void;
}) {
  const qc = useQueryClient();
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<{ path: string; content: string; isNew: boolean }>();
  const [error, setError] = useState<string>();
  const { data, error: loadError } = useQuery({
    queryKey: ["skills", "files", id],
    queryFn: () => skillsApi.get(id),
    select: (skill) => skill.files,
    enabled: open,
  });
  const changed = async () => {
    setError(undefined);
    await qc.invalidateQueries({ queryKey: ["skills"] });
    onChanged?.();
  };
  /** Runs a change to the folder and refreshes what shows it. */
  const act = async (work: () => Promise<unknown>) => {
    try {
      await work();
      await changed();
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  /** Reads a file to edit it: nothing changed, so nothing is refreshed. */
  const edit = async (path: string) => {
    try {
      const file = await skillsApi.file(id, path);
      if (file.encoding !== "utf8")
        throw new Error("That file is not text. Remove it and add another.");
      setError(undefined);
      setDraft({ path, content: file.content, isNew: false });
    } catch (e) {
      setError(errorMessage(e));
    }
  };
  return (
    <div className="text-xs">
      <Button
        size="sm"
        variant="ghost"
        type="button"
        aria-expanded={open}
        onClick={() => setOpen(!open)}
      >
        {count} {count === 1 ? "file" : "files"} next to SKILL.md
      </Button>
      {open && (
        <div className="mt-1 space-y-2 pl-3">
          <ul aria-label="Files of this skill" className="space-y-0.5 font-mono">
            {loadError && <li className="font-sans text-destructive">Could not load the files.</li>}
            {!data && !loadError && <li className="font-sans text-muted-foreground">Loading…</li>}
            {data?.map((f) => (
              <li key={f.path} className="flex flex-wrap items-center gap-x-3">
                <span className="break-all">{f.path}</span>
                <span className="tabular-nums text-muted-foreground">{formatSize(f.size)}</span>
                {f.mode === "executable" && (
                  <span className="font-sans text-muted-foreground">executable</span>
                )}
                {owned && (
                  <span className="flex gap-1 font-sans">
                    {/* No hint: it shows the text Edit. */}
                    <Button
                      size="sm"
                      variant="ghost"
                      type="button"
                      aria-label={`Edit ${f.path}`}
                      onClick={() => void edit(f.path)}
                    >
                      Edit
                    </Button>
                    <ConfirmButton
                      label="Remove"
                      question={`Remove ${f.path}?`}
                      confirmLabel="Yes, remove"
                      variant="destructive"
                      onConfirm={() => act(() => skillsApi.removeFiles(id, [f.path]))}
                    />
                  </span>
                )}
              </li>
            ))}
          </ul>
          {error && (
            <p role="alert" className="font-sans text-destructive">
              {error}
            </p>
          )}
          {owned && !draft && (
            <Button
              size="sm"
              variant="outline"
              type="button"
              onClick={() => setDraft({ path: "", content: "", isNew: true })}
            >
              Add a file
            </Button>
          )}
          {owned && draft && (
            <form
              aria-label="File"
              className="space-y-2 rounded-md border p-3 font-sans"
              onSubmit={(e) => {
                e.preventDefault();
                void act(async () => {
                  const executable = draft.content.startsWith("#!");
                  await skillsApi.putFiles(id, [
                    {
                      path: draft.path.trim(),
                      content: draft.content,
                      mode: executable ? "executable" : "file",
                    },
                  ]);
                  setDraft(undefined);
                });
              }}
            >
              <Input
                title="Path in the skill folder"
                required
                disabled={!draft.isNew}
                maxLength={300}
                placeholder="scripts/build.sh"
                value={draft.path}
                onChange={(e) => setDraft({ ...draft, path: e.target.value })}
              />
              {/* Plain on purpose: a file of the skill folder is read by other tools (scripts, references), so a mention of one of my bots would mean nothing there. */}
              <EditorField
                title="Content"
                rows={8}
                maxLength={1_000_000}
                value={draft.content}
                onChange={(content) => setDraft({ ...draft, content })}
              />
              <div className="flex gap-2">
                <Button size="sm" type="submit">
                  Save file
                </Button>
                <Button
                  size="sm"
                  type="button"
                  variant="outline"
                  onClick={() => setDraft(undefined)}
                >
                  Cancel
                </Button>
              </div>
            </form>
          )}
        </div>
      )}
    </div>
  );
}
