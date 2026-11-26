import { useState, type FormEvent } from "react";
import { WORKSPACE_NAME_MAX } from "@zetta/core/workspace";

import { Button, Input } from "@/components/ui";
import { toast } from "@/lib/notify";

import { errorMessage } from "../chat/chat-client";
import { formText } from "../shared/form-data";
import { Panel } from "../shared/ui";
import { workspaceApi, type StartedWorkspace } from "./workspace-api";

/** The address name from a workspace's name: lowercase letters, digits and dashes. */
export const slugOf = (name: string) =>
  name
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .slice(0, 63);

type StartedProps = { started: StartedWorkspace; onDone: () => void };
/** The owner's invitation code, shown once. */
function Started({ started, onDone }: StartedProps) {
  const copy = async () => {
    try {
      await navigator.clipboard.writeText(started.invitation.token);
      toast.success("Invitation code copied.");
    } catch {
      toast.error("Copy it by hand: select the code and copy it.");
    }
  };
  return (
    <div className="space-y-3 text-sm" aria-live="polite">
      <p className="text-pretty">
        {started.workspace.name} is ready. Send this code to its owner, privately: they sign up with
        it, or join with it if they already use this server. It is shown once and works for 24
        hours.
      </p>
      <Input
        title="Owner's invitation code"
        id="started-workspace-token"
        autoComplete="off"
        spellCheck={false}
        readOnly
        value={started.invitation.token}
        onFocus={(event) => event.target.select()}
      />
      <div className="flex flex-wrap gap-2">
        <Button variant="outline" onClick={() => void copy()}>
          Copy code
        </Button>
        <Button variant="ghost" onClick={onDone}>
          Done
        </Button>
      </div>
    </div>
  );
}

/**
 * Root starts a workspace for another organization: its name, its address name and the e-mail of the person who will own it. Root has
 * no seat in it: its owner invites their own people, and what is inside is theirs.
 */
export function StartWorkspace() {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const [slug, setSlug] = useState("");
  const [slugTouched, setSlugTouched] = useState(false);
  const [started, setStarted] = useState<StartedWorkspace>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    const form = event.currentTarget;
    const data = new FormData(form);
    setBusy(true);
    setError(undefined);
    try {
      setStarted(
        await workspaceApi.start({
          name: formText(data, "name").trim(),
          slug: formText(data, "slug").trim(),
          ownerEmail: formText(data, "ownerEmail").trim(),
        }),
      );
      form.reset();
      setSlug("");
      setSlugTouched(false);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <section id="start-workspace" aria-label="Start a workspace">
      <Panel
        title="Start a workspace"
        description="A workspace of its own for another organization, walled off from this one. You get the invitation code of its owner; you have no seat in it."
      >
        {started ? (
          <Started started={started} onDone={() => setStarted(undefined)} />
        ) : (
          <form onSubmit={(e) => void submit(e)} className="grid gap-3 text-sm sm:max-w-md">
            <Input
              name="name"
              title="Name"
              required
              maxLength={WORKSPACE_NAME_MAX}
              onChange={(e) => !slugTouched && setSlug(slugOf(e.currentTarget.value))}
            />
            <Input
              name="slug"
              title="Address name"
              required
              value={slug}
              pattern="[a-z0-9][a-z0-9-]{1,62}"
              onChange={(e) => {
                setSlugTouched(true);
                setSlug(e.currentTarget.value);
              }}
            />
            <Input name="ownerEmail" type="email" title="Owner's e-mail" required />
            {error && (
              <p role="alert" className="text-pretty text-destructive">
                {error}
              </p>
            )}
            <div>
              <Button type="submit" disabled={busy}>
                {busy ? "Starting…" : "Start workspace"}
              </Button>
            </div>
          </form>
        )}
      </Panel>
    </section>
  );
}
