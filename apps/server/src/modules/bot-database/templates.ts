/**
 * Starter templates: ready-made tables a person can add with one click (or the bot with db_apply_template). Every table and column has a
 * plain-language comment, which is what the Database tab shows instead of the raw names. Safe to apply twice (IF NOT EXISTS).
 */
export type Template = { id: "tasks" | "preferences" | "notes"; title: string; description: string; sql: string };

export const TEMPLATES: Template[] = [
  {
    id: "tasks", title: "Tasks", description: "A to-do list the bot keeps for you: what to do, when, and whether it is done.",
    sql: `create table if not exists tasks (
  id bigint generated always as identity primary key,
  title text not null,
  status text not null default 'todo' check (status in ('todo', 'doing', 'done')),
  due_at timestamptz,
  notes text,
  created_at timestamptz not null default now(),
  done_at timestamptz
);
comment on table tasks is 'Tasks: things to do, with a due date and status';
comment on column tasks.title is 'Task';
comment on column tasks.status is 'Status (todo, doing, done)';
comment on column tasks.due_at is 'Due';
comment on column tasks.notes is 'Notes';
comment on column tasks.created_at is 'Added';
comment on column tasks.done_at is 'Finished';`,
  },
  {
    id: "preferences", title: "Preferences", description: "Settings and likes the bot remembers about how you want things done.",
    sql: `create table if not exists preferences (
  key text primary key,
  value jsonb not null,
  updated_at timestamptz not null default now()
);
comment on table preferences is 'Preferences: how you like things done';
comment on column preferences.key is 'Preference';
comment on column preferences.value is 'Value';
comment on column preferences.updated_at is 'Last changed';`,
  },
  {
    id: "notes", title: "Notes", description: "Short notes the bot saves for later, with tags to find them again.",
    sql: `create table if not exists notes (
  id bigint generated always as identity primary key,
  title text not null,
  body text not null default '',
  tags text[] not null default '{}',
  created_at timestamptz not null default now()
);
comment on table notes is 'Notes: things saved for later';
comment on column notes.title is 'Title';
comment on column notes.body is 'Note';
comment on column notes.tags is 'Tags';
comment on column notes.created_at is 'Saved';`,
  },
];
export const templateById = (id: string) => TEMPLATES.find((t) => t.id === id);
