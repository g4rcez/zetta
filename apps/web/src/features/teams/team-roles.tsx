import {
  ArrowLeftIcon,
  BugIcon,
  ChartBarIcon,
  CheckCircleIcon,
  CodeIcon,
  CompassIcon,
  MagnifyingGlassIcon,
  PaletteIcon,
  PencilIcon,
  PlusIcon,
  ShieldIcon,
  UserIcon,
  type Icon,
} from "@phosphor-icons/react";
import { Link } from "@tanstack/react-router";
import { createContext, useCallback, useContext, useEffect, useState, type FormEvent } from "react";
import { toast } from "sonner";

import { cn } from "@zetta/ui/lib/utils";
import { Autocomplete, Button, Input, Select } from "@/components/ui";

import { errorMessage } from "../chat/chat-client";
import { Empty, Loading } from "../shared/ui";
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

const ColorSwatch = ({ color }: { color: TeamRoleColor }) => (
  <span aria-hidden className={cn("size-3 shrink-0 rounded-full bg-current", COLORS[color])} />
);
const RoleIconGlyph = ({ icon }: { icon: TeamRoleIcon }) => {
  const IconOf = ICONS[icon];
  return <IconOf aria-hidden className="size-4 shrink-0" />;
};
// The options and their renderers live at module level, so the Autocomplete gets stable references.
const COLOR_OPTIONS = TEAM_ROLE_COLORS.map((c) => ({
  value: c,
  label: label(c),
  Render: () => (
    <span className="flex items-center gap-2">
      <ColorSwatch color={c} /> {label(c)}
    </span>
  ),
}));
const ICON_OPTIONS = TEAM_ROLE_ICONS.map((i) => ({
  value: i,
  label: label(i),
  Render: () => (
    <span className="flex items-center gap-2">
      <RoleIconGlyph icon={i} /> {label(i)}
    </span>
  ),
}));

/** The user's role catalog. `reload` re-reads it; it also runs when the tab regains focus, because roles are managed in another tab. */
export function useTeamRoles() {
  const [roles, setRoles] = useState<TeamRole[]>([]);
  const [loaded, setLoaded] = useState(false);
  const reload = useCallback(
    () =>
      teamsApi
        .roles()
        .then(setRoles, (e) => {
          toast.error(errorMessage(e));
        })
        .finally(() => setLoaded(true)),
    [],
  );
  useEffect(() => {
    void reload();
    const onFocus = () => void reload();
    window.addEventListener("focus", onFocus);
    return () => window.removeEventListener("focus", onFocus);
  }, [reload]);
  return { roles, loaded, reload };
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
}: {
  roles: TeamRole[];
  value: string | null;
  onChange: (roleId: string | null) => void;
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
        <Link
          to="/team-roles"
          rel="noopener noreferrer"
          className="ml-auto underline underline-offset-2"
        >
          Manage roles
        </Link>
      </div>
    </div>
  );
}

const blank: TeamRoleInput = { name: "", description: "", color: "slate", icon: "user" };

/**
 * Create, edit and delete roles: the list on the left (30%), the form of the selected role on the right (70%).
 * A deleted role leaves its members in their teams without a role.
 */
export function TeamRolesPage() {
  const { roles, loaded, reload } = useTeamRoles();
  const [editing, setEditing] = useState<string>();
  const [draft, setDraft] = useState<TeamRoleInput>(blank);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string>();
  const select = (r?: TeamRole) => {
    setError(undefined);
    setEditing(r?.id);
    setDraft(
      r ? { name: r.name, description: r.description, color: r.color, icon: r.icon } : blank,
    );
  };
  async function run<T>(work: () => Promise<T>) {
    setBusy(true);
    setError(undefined);
    try {
      const result = await work();
      await reload();
      return { result };
    } catch (e) {
      setError(errorMessage(e));
      return undefined;
    } finally {
      setBusy(false);
    }
  }
  async function submit(event: FormEvent) {
    event.preventDefault();
    const input = { ...draft, name: draft.name.trim(), description: draft.description.trim() };
    const done = await run(() =>
      editing ? teamsApi.updateRole(editing, input) : teamsApi.createRole(input),
    );
    if (done) select(done.result);
  }
  async function remove(r: TeamRole) {
    if (await run(() => teamsApi.deleteRole(r.id))) {
      if (editing === r.id) select();
    }
  }
  const current = roles.find((r) => r.id === editing);
  return (
    <div className="flex h-full min-h-0 flex-col">
      <header className="flex items-center gap-3 border-b px-4 py-3 md:px-6">
        <Link
          to="/teams"
          className="inline-flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground"
        >
          <ArrowLeftIcon aria-hidden className="size-4" /> Back to teams
        </Link>
        <h1 className="text-xl text-balance">Team roles</h1>
      </header>
      <div className="grid min-h-0 flex-1 grid-cols-1 md:grid-cols-[minmax(0,3fr)_minmax(0,7fr)]">
        <nav
          aria-label="Roles"
          className="flex min-h-0 flex-col border-b md:border-r md:border-b-0"
        >
          <div className="border-b p-2">
            <Button
              type="button"
              size="sm"
              variant={editing ? "outline" : "default"}
              className="w-full"
              disabled={busy}
              onClick={() => select()}
            >
              <PlusIcon aria-hidden className="size-4" /> New role
            </Button>
          </div>
          <ul className="min-h-0 flex-1 overflow-y-auto p-1">
            {roles.map((r) => (
              <li key={r.id}>
                <button
                  type="button"
                  aria-current={r.id === editing ? "true" : undefined}
                  onClick={() => select(r)}
                  className={cn(
                    "flex w-full min-w-0 flex-col items-start gap-1 rounded-md px-3 py-2 text-left text-sm hover:bg-muted",
                    r.id === editing && "bg-muted",
                  )}
                >
                  <RoleBadge role={r} />
                  {r.description && (
                    <span className="w-full truncate text-xs text-muted-foreground">
                      {r.description}
                    </span>
                  )}
                </button>
              </li>
            ))}
            {loaded && !roles.length && <Empty>No roles yet.</Empty>}
            {!loaded && <Loading />}
          </ul>
        </nav>
        <form
          onSubmit={(e) => void submit(e)}
          className="min-h-0 space-y-4 overflow-y-auto p-4 md:p-6"
        >
          <h2 className="font-medium">{current ? `Edit ${current.name}` : "New role"}</h2>
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
            <Autocomplete
              title="Color"
              reportStatus={false}
              required={false}
              left={<ColorSwatch color={draft.color} />}
              value={draft.color}
              onChange={(e) => {
                const color = TEAM_ROLE_COLORS.find((c) => c === e.target.value);
                if (color) setDraft({ ...draft, color });
              }}
              options={COLOR_OPTIONS}
              emptyMessage="No color matches"
            />
            <Autocomplete
              title="Icon"
              reportStatus={false}
              required={false}
              left={<RoleIconGlyph icon={draft.icon} />}
              value={draft.icon}
              onChange={(e) => {
                const icon = TEAM_ROLE_ICONS.find((i) => i === e.target.value);
                if (icon) setDraft({ ...draft, icon });
              }}
              options={ICON_OPTIONS}
              emptyMessage="No icon matches"
            />
          </div>
          {draft.name.trim() && <RoleBadge role={{ ...draft, name: draft.name.trim() }} />}
          {error && (
            <p role="alert" className="text-sm text-destructive">
              {error}
            </p>
          )}
          <div className="flex justify-end gap-2">
            {current && (
              <Button
                type="button"
                variant="outline"
                aria-label={`Delete ${current.name}`}
                disabled={busy}
                onClick={() => void remove(current)}
              >
                Delete
              </Button>
            )}
            <Button type="submit" disabled={busy || !draft.name.trim()}>
              {current ? "Save role" : "Add role"}
            </Button>
          </div>
        </form>
      </div>
    </div>
  );
}
