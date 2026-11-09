import { useEffect, useState, type FormEvent } from "react";

import { EditorField } from "@/components/editor/editor";
import { Button, Input } from "@/components/ui";
import { parseMarkdown } from "../claude/claude-api";
import { formatSize } from "../artifacts/artifacts-api";
import { skillsApi, toSkillName, type SkillCheck, type SkillDraft } from "./skills-api";

/** Name, when to use it, and the instructions. A SKILL.md file fills the three fields, so a skill from anywhere can be pasted in. */
export function SkillForm({
  initial,
  skillId,
  submitLabel,
  onSubmit,
  onCancel,
}: {
  initial?: SkillDraft;
  /** The skill being edited, so its own name is not taken for a clash. */
  skillId?: string;
  submitLabel: string;
  onSubmit: (draft: SkillDraft) => void | Promise<void>;
  onCancel?: () => void;
}) {
  const [draft, setDraft] = useState<SkillDraft>(
    initial ?? { name: "", description: "", body: "" },
  );
  const set = (patch: Partial<SkillDraft>) => setDraft((d) => ({ ...d, ...patch }));
  // What a save would say, asked a moment after typing stops. Only the fields that have text are sent, so a half-filled form shows no "required" noise.
  const [check, setCheck] = useState<SkillCheck>();
  useEffect(() => {
    const fields = {
      ...(draft.name.trim() && { name: draft.name.trim() }),
      ...(draft.description.trim() && { description: draft.description.trim() }),
      ...(draft.body.trim() && { body: draft.body.trim() }),
    };
    if (Object.keys(fields).length === 0) {
      setCheck(undefined);
      return;
    }
    let current = true;
    const timer = setTimeout(() => {
      skillsApi.check({ ...fields, ...(skillId && { skillId }) }).then(
        (r) => current && setCheck(r),
        () => current && setCheck(undefined),
      );
    }, 350);
    return () => {
      current = false;
      clearTimeout(timer);
    };
  }, [draft.name, draft.description, draft.body, skillId]);
  const submit = (e: FormEvent) => {
    e.preventDefault();
    void onSubmit({
      name: draft.name.trim(),
      description: draft.description.trim(),
      body: draft.body.trim(),
    });
  };
  return (
    <form onSubmit={submit} className="space-y-2">
      <label className="inline-block cursor-pointer text-sm underline underline-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
        Fill from a SKILL.md file
        <input
          type="file"
          accept=".md,text/markdown"
          className="sr-only"
          onChange={(e) => {
            const input = e.currentTarget;
            const file = input.files?.[0];
            if (!file) return;
            void file.text().then((text) => {
              const p = parseMarkdown(text);
              set({
                name: toSkillName(p.name ?? file.name.replace(/\.md$/i, "")),
                description: p.description ?? "",
                body: p.body,
              });
              input.value = "";
            });
          }}
        />
      </label>
      <Input
        title="Name"
        required
        maxLength={63}
        pattern="[a-z][a-z0-9\-]*"
        value={draft.name}
        onChange={(e) => set({ name: e.target.value })}
        placeholder="release-notes"
      />
      <Input
        title="When should a bot use it?"
        required
        maxLength={600}
        value={draft.description}
        onChange={(e) => set({ description: e.target.value })}
        placeholder="Use when the user asks for release notes"
      />
      {/* Plain on purpose: a skill is a SKILL.md file that other tools read, so a mention of one of my bots would mean nothing there. */}
      <EditorField
        title="Instructions"
        required
        rows={8}
        maxLength={64000}
        value={draft.body}
        onChange={(body) => set({ body })}
        placeholder="1) List the merged pull requests. 2) Group them by area. 3) Write one line each."
      />
      {check && <CheckNotes check={check} />}
      <div className="flex gap-2">
        <Button size="sm" type="submit">
          {submitLabel}
        </Button>
        {onCancel && (
          <Button size="sm" type="button" variant="outline" onClick={onCancel}>
            Cancel
          </Button>
        )}
      </div>
    </form>
  );
}

/** The size, what would stop the save, what is worth knowing, and the skills that look the same. */
function CheckNotes({ check }: { check: SkillCheck }) {
  return (
    <div role="status" aria-label="Checks" className="space-y-1 text-xs">
      <p className="text-muted-foreground">{formatSize(check.bodyBytes)} of 64 KB</p>
      {check.problems.map((p) => (
        <p key={p} className="text-destructive">
          {p}
        </p>
      ))}
      {check.warnings.map((w) => (
        <p key={w} className="text-warn">
          {w}
        </p>
      ))}
      {check.similar.length > 0 && (
        <p className="text-muted-foreground">
          You already have {check.similar.length === 1 ? "a similar skill" : "similar skills"}:{" "}
          {check.similar.map((x) => x.name).join(", ")}.
        </p>
      )}
    </div>
  );
}
