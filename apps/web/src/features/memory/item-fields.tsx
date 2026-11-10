import { useState } from "react";

import { EditorField } from "@/components/editor/editor";
import { Input, Select } from "@/components/ui";

import { MemoryLinkTextarea } from "./memory-link-textarea";
import { formText } from "../shared/form-data";
import {
  BOT_ACCESS,
  TYPE,
  type Bot,
  type BotAccess,
  type Item,
  type Page,
  type TeamName,
  type MemoryType,
} from "./memory-api";

export function Fields({
  page,
  meta,
  contentLocked,
  bots,
  teams,
  items,
  self,
}: {
  page?: Pick<Page, "title" | "howto" | "content" | "tags"> &
    Partial<Pick<Page, "type" | "score" | "authorBotId" | "teams" | "botAccess">>;
  /** The visibility and score fields: not for a suggestion, and not for a shared item (the Share button sets that). */
  meta?: boolean;
  /** A source item: its text is kept unchanged, so the form has no content field. */
  contentLocked?: boolean;
  bots?: Bot[] | undefined;
  teams?: TeamName[] | undefined;
  /** The memory's items, for the `[[` autocomplete of the content. Without them the content is a plain textarea. */
  items?: readonly Item[] | undefined;
  /** The slug of the item being edited, so it is not offered as a link to itself. */
  self?: string | undefined;
}) {
  const [type, setType] = useState<MemoryType>(page?.type ?? "owner");
  return (
    <>
      <Input
        title="Title"
        name="title"
        required
        maxLength={160}
        defaultValue={page?.title}
        placeholder="e.g. Acme billing"
      />
      <Input
        title="How to use it (when a bot should open this item; shown in search)"
        name="howto"
        maxLength={300}
        defaultValue={page?.howto}
      />
      <Input
        title="Tags (separated by commas)"
        name="tags"
        defaultValue={page?.tags.join(", ")}
        placeholder="e.g. system, billing, instruction"
      />
      {contentLocked ? (
        <p className="text-sm text-muted-foreground">
          The text of a source is kept unchanged, so it is not edited here. Title, tags and the
          settings below can change.
        </p>
      ) : items ? (
        <MemoryLinkTextarea
          title="Content (Markdown; type [[ to link another item)"
          defaultValue={page?.content}
          items={items}
          self={self}
        />
      ) : (
        // Plain on purpose: Markdown that links with `[[`, which has its own picker in `MemoryLinkTextarea`.
        <EditorField
          title="Content (Markdown; link other items as [[slug]], [[depends-on:slug]], [[part-of:slug]] or [[supersedes:slug]])"
          name="content"
          required
          rows={10}
          maxLength={20000}
          defaultValue={page?.content}
        />
      )}
      {meta && (
        <>
          <Select
            title="Who can read it"
            name="type"
            required={false}
            value={type}
            onChange={(e) => setType(e.target.value as MemoryType)}
            options={(["owner", "teams", "solo"] as const).map((value) => ({
              value,
              label: TYPE[value],
            }))}
          />
          <Select
            title="Bots can"
            name="botAccess"
            required={false}
            // A new item is yours: bots suggest, you accept. The same default the server gives an item a person writes.
            defaultValue={page?.botAccess ?? "suggest"}
            options={(Object.keys(BOT_ACCESS) as BotAccess[]).map((value) => ({
              value,
              label: BOT_ACCESS[value],
            }))}
          />
          {type === "solo" && (
            <Select
              title="The bot that reads it"
              name="authorBotId"
              required={false}
              defaultValue={page?.authorBotId ?? bots?.[0]?.id ?? ""}
              options={(bots ?? []).map((b) => ({ value: b.id, label: b.name }))}
            />
          )}
          {type === "teams" && (
            <fieldset className="space-y-1">
              <legend className="text-sm font-medium">Teams whose bots read it</legend>
              {(teams ?? []).length === 0 && (
                <p className="text-sm text-muted-foreground">You have no teams yet.</p>
              )}
              {(teams ?? []).map((t) => (
                <label key={t.id} className="flex items-center gap-2 text-sm">
                  <input
                    type="checkbox"
                    name="teams"
                    value={t.id}
                    defaultChecked={page?.teams?.includes(t.id) ?? false}
                  />
                  {t.name}
                </label>
              ))}
            </fieldset>
          )}
          <Input
            title="Score (0-100: how important it is; 80 and more is shown to bots first)"
            name="score"
            type="number"
            min={0}
            max={100}
            defaultValue={page?.score ?? 50}
          />
        </>
      )}
    </>
  );
}
/** What a version holds; also what a suggestion sends. */
export const contentFields = (f: FormData) => ({
  title: formText(f, "title").trim(),
  howto: formText(f, "howto").trim(),
  content: formText(f, "content").trim(),
  tags: formText(f, "tags")
    .split(",")
    .map((t) => t.trim())
    .filter(Boolean),
});
/** Who reads it, what bots may do with it, and how important it is. A shared item has no type field: it stays shared. */
export const metaFields = (f: FormData) => {
  const type = f.get("type");
  const botAccess = f.get("botAccess");
  const score = Number(f.get("score"));
  return {
    ...(botAccess && { botAccess: String(botAccess) }),
    ...(Number.isInteger(score) && f.get("score") !== null && { score }),
    ...(type && {
      type: String(type),
      teams: f.getAll("teams").map(String),
      ...(f.get("authorBotId") && { authorBotId: formText(f, "authorBotId") }),
    }),
  };
};
