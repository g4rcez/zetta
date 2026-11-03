import { useCallback, useEffect, useState, type FormEvent } from "react";
import { EditorField } from "@/components/editor/editor";
import { Button, Input, Select } from "@/components/ui";
import { errorMessage } from "../chat/chat-client";
import {
  exportUrl,
  outputStylesApi,
  type BuiltinStyle,
  type OutputStyle,
  type StyleScope,
} from "../output-styles/output-styles-api";
import { Badge, ConfirmButton, Empty, list, listItem, Panel } from "../shared/ui";

const SCOPES: { value: StyleScope; label: string }[] = [
  { value: "private", label: "Only me" },
  { value: "installation", label: "Everyone here" },
];
const exportLink = "text-xs underline underline-offset-2 hover:text-foreground";

function Download({ href, name }: { href: string; name: string }) {
  return (
    <a href={href} download className={exportLink} aria-label={`Export ${name} as a file`}>
      Export
    </a>
  );
}

export function OutputStyles({ onError }: { onError: (m: string) => void }) {
  const [data, setData] = useState<{ builtins: BuiltinStyle[]; styles: OutputStyle[] }>();
  const [editing, setEditing] = useState<string>();
  const [status, setStatus] = useState<string>();
  const [error, setError] = useState<string>();
  const reload = useCallback(
    () => outputStylesApi.list().then(setData, (e) => onError(errorMessage(e))),
    [onError],
  );
  useEffect(() => {
    void reload();
  }, [reload]);

  const run = async (work: () => Promise<unknown>, done: string) => {
    setError(undefined);
    setStatus(undefined);
    try {
      await work();
      setStatus(done);
    } catch (e) {
      setError(errorMessage(e));
    }
    await reload();
  };
  const draft = (f: FormData) => ({
    name: String(f.get("name") ?? "").trim(),
    description: String(f.get("description") ?? "").trim(),
    body: String(f.get("body") ?? "").trim(),
    scope: String(f.get("scope") ?? "private") as StyleScope,
  });
  const fields = (s?: OutputStyle) => (
    <>
      <Input
        title="Name"
        name="name"
        required
        maxLength={60}
        defaultValue={s?.name}
        placeholder="e.g. Friendly mentor"
      />
      <Input
        title="Description (optional)"
        name="description"
        required={false}
        maxLength={280}
        defaultValue={s?.description}
        placeholder="One line that tells people what it sounds like"
      />
      {/* Plain on purpose: a style is shared with other users, so a mention of one of my bots would mean nothing to them. */}
      <EditorField
        title="How the bot should write"
        name="body"
        required
        rows={5}
        maxLength={8192}
        defaultValue={s?.body}
        placeholder="Lead with the answer. Use plain words. Never use jargon without explaining it."
      />
      <Select
        title="Who can use it"
        required={false}
        name="scope"
        defaultValue={s?.scope ?? "private"}
        options={SCOPES}
      />
    </>
  );

  const mine = data?.styles.filter((s) => s.mine) ?? [];
  const shared = data?.styles.filter((s) => !s.mine) ?? [];
  return (
    <div className="space-y-6">
      <Panel
        title="Output styles"
        label="Output styles"
        description="How a bot writes: its tone of voice and the shape of its answers. Pick one per bot in its settings."
        action={
          <label className="cursor-pointer text-sm underline underline-offset-2 has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-ring">
            Import a style file
            <input
              type="file"
              accept=".md,text/markdown"
              className="sr-only"
              onChange={(e) => {
                const input = e.currentTarget;
                const file = input.files?.[0];
                if (!file) return;
                void run(
                  async () => outputStylesApi.importFile(await file.text()),
                  "Imported. It is private to you.",
                ).finally(() => {
                  input.value = "";
                });
              }}
            />
          </label>
        }
      >
        <p role="status" className="text-xs empty:hidden">
          {status}
        </p>
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <ul className={list} aria-label="Built-in styles">
          {data?.builtins.map((b) => (
            <li
              key={b.key}
              className={`${listItem} flex flex-wrap items-start justify-between gap-2`}
            >
              <div className="min-w-0">
                <p className="font-medium">{b.name}</p>
                <p className="text-muted-foreground">{b.description}</p>
              </div>
              <div className="flex items-center gap-2">
                <Badge>Built-in</Badge>
                {b.body && <Download href={exportUrl({ builtin: b.key })} name={b.name} />}
              </div>
            </li>
          ))}
        </ul>
      </Panel>

      <Panel
        title="My styles"
        label="My styles"
        count={data ? mine.length : undefined}
        description="Write your own, and share it with the people here or send them the file."
      >
        <form
          onSubmit={(e) => {
            e.preventDefault();
            const form = e.currentTarget;
            void run(async () => {
              await outputStylesApi.create(draft(new FormData(form)));
              form.reset();
            }, "Saved.");
          }}
          className="space-y-2"
        >
          {fields()}
          <Button size="sm" type="submit">
            Save style
          </Button>
        </form>
        {data && mine.length === 0 && <Empty>No styles of your own yet.</Empty>}
        <ul className={list}>
          {mine.map((s) => (
            <li key={s.id} className={listItem}>
              {editing === s.id ? (
                <form
                  onSubmit={(e: FormEvent<HTMLFormElement>) => {
                    e.preventDefault();
                    const values = draft(new FormData(e.currentTarget));
                    void run(async () => {
                      await outputStylesApi.update(s.id, s.version, values);
                      setEditing(undefined);
                    }, "Updated. Every bot that uses it now writes this way.");
                  }}
                  className="space-y-2"
                >
                  {fields(s)}
                  <div className="flex gap-2">
                    <Button size="sm" type="submit">
                      Save
                    </Button>
                    <Button
                      size="sm"
                      type="button"
                      variant="outline"
                      onClick={() => setEditing(undefined)}
                    >
                      Cancel
                    </Button>
                  </div>
                </form>
              ) : (
                <div className="space-y-1">
                  <div className="flex flex-wrap items-center justify-between gap-2">
                    <p className="font-medium">{s.name}</p>
                    <Badge>
                      {s.scope === "installation" ? "Shared with everyone here" : "Only me"}
                    </Badge>
                  </div>
                  {s.description && <p className="text-muted-foreground">{s.description}</p>}
                  <p className="line-clamp-3 whitespace-pre-wrap break-words text-xs text-muted-foreground">
                    {s.body}
                  </p>
                  <div className="flex flex-wrap items-center gap-2 pt-1">
                    <Button
                      size="sm"
                      variant="outline"
                      type="button"
                      onClick={() => setEditing(s.id)}
                    >
                      Edit
                    </Button>
                    <Download href={exportUrl({ id: s.id })} name={s.name} />
                    <ConfirmButton
                      label="Delete"
                      question="Delete this style? Bots that use it keep writing this way until you change them."
                      confirmLabel="Yes, delete"
                      variant="destructive"
                      onConfirm={() => run(() => outputStylesApi.archive(s.id), "Deleted.")}
                    />
                  </div>
                </div>
              )}
            </li>
          ))}
        </ul>
      </Panel>

      {shared.length > 0 && (
        <Panel
          title="Shared with me"
          label="Shared with me"
          count={shared.length}
          description="Styles other people here published. You can use them but not change them."
        >
          <ul className={list}>
            {shared.map((s) => (
              <li
                key={s.id}
                className={`${listItem} flex flex-wrap items-start justify-between gap-2`}
              >
                <div className="min-w-0">
                  <p className="font-medium">{s.name}</p>
                  {s.description && <p className="text-muted-foreground">{s.description}</p>}
                  <p className="text-xs text-muted-foreground">Shared by {s.ownerName}</p>
                </div>
                <Download href={exportUrl({ id: s.id })} name={s.name} />
              </li>
            ))}
          </ul>
        </Panel>
      )}
    </div>
  );
}
