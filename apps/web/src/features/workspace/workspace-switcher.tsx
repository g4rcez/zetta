import { useQuery } from "@tanstack/react-query";
import { useNavigate } from "@tanstack/react-router";
import { CaretUpDownIcon, PlusIcon, SignInIcon } from "@phosphor-icons/react";
import { useState, type FormEvent } from "react";

import { Button, Input, Menu, MenuGroup, MenuItem, MenuSeparator, Modal } from "@/components/ui";
import { toast } from "@/lib/notify";

import { errorMessage } from "../chat/chat-client";
import { formText } from "../shared/form-data";
import { workspaceApi, workspaceQueries } from "./workspace-api";

type JoinProps = { open: boolean; onClose: () => void; onJoined: (slug: string) => void };
/**
 * Another workspace's invitation, for a person who is already here: the code its administrator gave them. Someone new signs up with the
 * same code instead.
 */
function JoinWorkspace({ open, onClose, onJoined }: JoinProps) {
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const submit = async (event: FormEvent<HTMLFormElement>) => {
    event.preventDefault();
    // A pasted code often brings the spaces around it.
    const token = formText(new FormData(event.currentTarget), "token").trim();
    if (!token) return setError("Paste the invitation code you were given.");
    setBusy(true);
    setError(undefined);
    try {
      const joined = await workspaceApi.join(token);
      toast.success(`You joined ${joined.name}.`);
      onJoined(joined.slug);
    } catch (e) {
      setError(errorMessage(e));
    } finally {
      setBusy(false);
    }
  };
  return (
    <Modal
      open={open}
      onChange={(next: boolean) => !next && onClose()}
      title="Join a workspace"
      ariaDescription="Paste the invitation code an administrator of that workspace gave you."
      overlayClickClose
    >
      <form onSubmit={(e) => void submit(e)} className="flex flex-col gap-3 text-sm">
        <p className="text-pretty text-muted-foreground">
          Paste the invitation code an administrator of that workspace gave you. It must be made out
          to your e-mail address.
        </p>
        <Input name="token" title="Invitation code" autoComplete="off" spellCheck={false} />
        {error && (
          <p role="alert" className="text-pretty text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          <Button type="button" variant="ghost" onClick={onClose}>
            Cancel
          </Button>
          <Button type="submit" disabled={busy}>
            {busy ? "Joining…" : "Join"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}

/**
 * The workspace this tab works in, and the others the person is in. Choosing one opens its overview: what the page showed belongs to the
 * workspace before. The choice lives in the address (lib/workspace-scope.ts), so each tab keeps its own.
 */
export function WorkspaceSwitcher({ collapsed }: { collapsed: boolean }) {
  const { data } = useQuery(workspaceQueries.all());
  const navigate = useNavigate();
  const [joining, setJoining] = useState(false);
  if (!data || !data.workspaces.length) return null;
  const current = data.workspaces.find((w) => w.current) ?? data.workspaces[0]!;
  const open = (slug: string) => void navigate({ to: "/dashboard", search: { w: slug } as never });
  const trigger = collapsed ? (
    <span
      aria-hidden="true"
      className="flex size-8 items-center justify-center rounded-md bg-muted text-xs font-semibold"
    >
      {current.name.slice(0, 1).toUpperCase()}
    </span>
  ) : (
    <span className="flex min-w-0 items-center gap-1.5 px-2 text-sm">
      <span className="truncate font-medium">{current.name}</span>
      <CaretUpDownIcon aria-hidden="true" className="size-3.5 shrink-0 text-muted-foreground" />
    </span>
  );
  return (
    <>
      <Menu
        hover={false}
        title={`Workspace: ${current.name}`}
        floatingClassName="w-64 max-w-[calc(100vw-1rem)]"
        label={trigger}
      >
        <MenuGroup label="Workspaces">
          {data.workspaces.map((w) => (
            <MenuItem
              key={w.id}
              title={w.name}
              role="menuitemradio"
              checked={w.id === current.id}
              onClick={() => w.id !== current.id && open(w.slug)}
            >
              <span className="truncate">{w.name}</span>
            </MenuItem>
          ))}
        </MenuGroup>
        <MenuSeparator />
        <MenuItem title="Join a workspace" onClick={() => setJoining(true)}>
          <SignInIcon aria-hidden="true" />
          Join a workspace
        </MenuItem>
        {data.mayCreate && (
          <MenuItem
            title="Start a workspace for another organization"
            onClick={() =>
              void navigate({
                to: "/studio/$tab",
                params: { tab: "invites" },
                hash: "start-workspace",
              })
            }
          >
            <PlusIcon aria-hidden="true" />
            Start a workspace
          </MenuItem>
        )}
      </Menu>
      <JoinWorkspace
        open={joining}
        onClose={() => setJoining(false)}
        onJoined={(slug) => {
          setJoining(false);
          open(slug);
        }}
      />
    </>
  );
}
