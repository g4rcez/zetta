import {
  BugIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CodeIcon,
  CompassIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PencilIcon,
  ShieldIcon,
  UserIcon,
  type Icon,
} from "@phosphor-icons/react";
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { cn } from "@zetta/ui/lib/utils";
import { Button, Input, Select } from "@/components/ui";

import { errorMessage } from "../chat/chat-client";
import { Modal } from "../shared/ui";
import {
  TEAM_ROLE_COLORS,
  TEAM_ROLE_ICONS,
  teamsApi,
  type TeamRole,
  type TeamRoleColor,
  type TeamRoleIcon,
  type TeamRoleInput,
} from "./teams-api";

const ICONS: Record<TeamRoleIcon, Icon> = {
  user: UserIcon,
  "magnifying-glass": MagnifyingGlassIcon,
  code: CodeIcon,
  pencil: PencilIcon,
  "check-circle": CheckCircleIcon,
  palette: PaletteIcon,
  "chart-bar": ChartBarIcon,
  bug: BugIcon,
  compass: CompassIcon,
  shield: ShieldIcon,
};
// Literal class names, so Tailwind sees them. A role's color is the user's own label choice, so it colors only the icon;
// the name stays in --foreground on --muted to keep 7:1 text contrast (DESIGN.md "Contrast table").
const COLORS: Record<TeamRoleColor, string> = {
  slate: "text-slate-700 dark:text-slate-400",
  red: "text-red-700 dark:text-red-400",
  orange: "text-orange-700 dark:text-orange-400",
  amber: "text-amber-700 dark:text-amber-400",
  green: "text-green-700 dark:text-green-400",
  teal: "text-teal-700 dark:text-teal-400",
  blue: "text-blue-700 dark:text-blue-400",
  violet: "text-violet-700 dark:text-violet-400",
  pink: "text-pink-700 dark:text-pink-400",
};
const label = (v: string) => v.replace(/-/g, " ").replace(/^./, (c) => c.toUpperCase());

/** The user's role catalog. `reload` re-reads it after the manage dialog changes it. */
export function useTeamRoles() {
  const [roles, setRoles] = useState<TeamRole[]>([]);
  const reload = useCallback(
    () =>
      teamsApi.roles().then(setRoles, (e) => {
        toast.error(errorMessage(e));
      }),
    [],
  );
  useEffect(() => {
    void reload();
  }, [reload]);
  return { roles, reload };
}

/** React Flow renders the bot cards itself, so the canvas hands them the catalog through context. */
export const RolesContext = createContext<TeamRole[]>([]);
/** The subtitle of a bot card: its role, or its place in the team. */
export function useRoleLabel(roleId: string | null, chief: boolean) {
  const roles = useContext(RolesContext);
  return roles.find((r) => r.id === roleId)?.name ?? (chief ? "Chief" : "Member");
}

export function RoleBadge({
  role,
  className,
}: {
  role: Pick<TeamRoleInput, "name" | "color" | "icon">;
  className?: string;
}) {
  const IconOf = ICONS[role.icon];
  return (
    <span
      className={cn(
        "inline-flex max-w-full items-center gap-1 rounded-sm bg-muted px-2 py-0.5 text-xs font-medium text-foreground",
        className,
      )}
    >
      <IconOf className={cn("size-3 shrink-0", COLORS[role.color])} aria-hidden="true" />
      <span className="truncate">{role.name}</span>
    </span>
  );
}

/** Picks one role of the catalog, or none. The badge under the select shows what the role does. */
export function RoleField({
  roles,
  value,
  onChange,
  onManage,
}: {
  roles: TeamRole[];
  value: string | null;
  onChange: (roleId: string | null) => void;
  onManage: () => void;
}) {
  const current = roles.find((r) => r.id === value);
  return (
    <div className="space-y-1.5">
      <Select
        title="Role in this team"
        reportStatus={false}
        required={false}
        value={value ?? ""}
        onChange={(e) => onChange(e.target.value || null)}
        options={[
          { value: "", label: "No role" },
          ...roles.map((r) => ({ value: r.id, label: r.name })),
        ]}
      />
      <div className="flex min-h-6 flex-wrap items-center gap-2 text-xs text-muted-foreground">
        {current && <RoleBadge role={current} />}
        {current?.description && <span className="min-w-0 truncate">{current.description}</span>}
        <button type="button" className="ml-auto underline underline-offset-2" onClick={onManage}>
          Manage roles
        </button>
      </div>
    </div>
  );
}

const blank: TeamRoleInput = { name: "", description: "", color: "slate", icon: "user" };

/** Create, edit and delete roles. A deleted role leaves its members in their teams without a role. */
export function RolesDialog({
  roles,
  onChanged,
  onClose,
}: {
  roles: TeamRole[];
  onChanged: () => Promise<unknown>;
  onClose: () => void;
}) {
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<TeamRoleInput>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const edit = (r?: TeamRole) => {
    setError(undefined);
    setEditing(r?.id);
    setDraft(
      r ? { name: r.name, description: r.description, color: r.color, icon: r.icon } : blank,
    );
  };
  async function run(work: () => Promise<unknown>) {
    setBusy(true);
    setError(undefined);
    try {
      await work();
      await onChanged();
      return true;
    } catch (e) {
      setError(errorMessage(e));
      return false;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
    if (
      await run(() => (editing ? teamsApi.updateRole(editing, input) : teamsApi.createRole(input)))
    )
      edit();
  }
  return (
    <Modal title="Team roles" onClose={onClose}>
      <ul className="max-h-60 space-y-1 overflow-y-auto">
        {roles.map((r) => (
          <li key={r.id} className="flex items-center gap-2">
            <RoleBadge role={r} />
            <span className="min-w-0 flex-1 truncate text-xs text-muted-foreground">
              {r.description}
            </span>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Edit ${r.name}`}
              disabled={busy}
              onClick={() => edit(r)}
            >
              Edit
            </Button>
            <Button
              type="button"
              size="sm"
              variant="ghost"
              aria-label={`Delete ${r.name}`}
              disabled={busy}
              onClick={() => {
                if (editing === r.id) edit();
                void run(() => teamsApi.deleteRole(r.id));
              }}
            >
              Delete
            </Button>
          </li>
        ))}
      </ul>
      <form onSubmit={(e) => void submit(e)} className="space-y-3 border-t pt-3">
        <p className="font-medium">{editing ? "Edit role" : "New role"}</p>
        <Input
          title="Name"
          reportStatus={false}
          maxLength={60}
          required
          value={draft.name}
          onChange={(e) => setDraft({ ...draft, name: e.target.value })}
        />
        <Input
          title="What it does"
          reportStatus={false}
          required={false}
          maxLength={200}
          value={draft.description}
          onChange={(e) => setDraft({ ...draft, description: e.target.value })}
        />
        <div className="grid gap-3 sm:grid-cols-2">
          <Select
            title="Color"
            reportStatus={false}
            required={false}
            value={draft.color}
            onChange={(e) => setDraft({ ...draft, color: e.target.value as TeamRoleColor })}
            options={TEAM_ROLE_COLORS.map((c) => ({ value: c, label: label(c) }))}
          />
          <Select
            title="Icon"
            reportStatus={false}
            required={false}
            value={draft.icon}
            onChange={(e) => setDraft({ ...draft, icon: e.target.value as TeamRoleIcon })}
            options={TEAM_ROLE_ICONS.map((i) => ({ value: i, label: label(i) }))}
          />
        </div>
        {draft.name.trim() && <RoleBadge role={{ ...draft, name: draft.name.trim() }} />}
        {error && (
          <p role="alert" className="text-sm text-destructive">
            {error}
          </p>
        )}
        <div className="flex justify-end gap-2">
          {editing && (
            <Button type="button" variant="outline" disabled={busy} onClick={() => edit()}>
              Cancel
            </Button>
          )}
          <Button type="submit" disabled={busy || !draft.name.trim()}>
            {editing ? "Save role" : "Add role"}
          </Button>
        </div>
      </form>
    </Modal>
  );
}
