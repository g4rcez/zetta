import { Input, Select } from "@/components/ui";
import { ApiError } from "../chat/chat-client";
import type { Detection, MailSecurity, MailServers, ServerFields } from "./mail-api";

/** The server fields as the person edits them: ports are text until they are sent. */
export type ServerDraft = {
  imapHost: string;
  imapPort: string;
  imapSecurity: MailSecurity;
  smtpHost: string;
  smtpPort: string;
  smtpSecurity: MailSecurity;
  user: string;
};

export const EMPTY_SERVERS: ServerDraft = {
  imapHost: "",
  imapPort: "993",
  imapSecurity: "tls",
  smtpHost: "",
  smtpPort: "587",
  smtpSecurity: "starttls",
  user: "",
};

export const draftOfMailbox = (s: MailServers): ServerDraft => ({
  imapHost: s.imapHost ?? "",
  imapPort: String(s.imapPort ?? 993),
  imapSecurity: s.imapSecurity ?? "tls",
  smtpHost: s.smtpHost ?? "",
  smtpPort: String(s.smtpPort ?? 587),
  smtpSecurity: s.smtpSecurity ?? "starttls",
  user: s.user ?? "",
});

/** What detection suggests, over the current draft: a field it does not know stays as it was. */
export function draftFromDetection(d: Detection, address: string, base: ServerDraft): ServerDraft {
  return {
    imapHost: d.imap?.host ?? base.imapHost,
    imapPort: String(d.imap?.port ?? base.imapPort),
    imapSecurity: d.imap?.security ?? base.imapSecurity,
    smtpHost: d.smtp?.host ?? base.smtpHost,
    smtpPort: String(d.smtp?.port ?? base.smtpPort),
    smtpSecurity: d.smtp?.security ?? base.smtpSecurity,
    user: d.user ?? (base.user || address),
  };
}

const portOf = (v: string) => (/^\d{1,5}$/.test(v.trim()) ? Number(v.trim()) : 0);

export type ServerProblem = Partial<Record<"imap" | "smtp" | "user", string>>;

/** The draft as a request, or what is missing. */
export function serverFields(
  d: ServerDraft,
): { ok: true; fields: ServerFields } | { ok: false; problem: ServerProblem } {
  const problem: ServerProblem = {};
  if (!d.imapHost.trim() || portOf(d.imapPort) < 1 || portOf(d.imapPort) > 65535)
    problem.imap = "Enter the incoming mail server and its port.";
  if (!d.smtpHost.trim() || portOf(d.smtpPort) < 1 || portOf(d.smtpPort) > 65535)
    problem.smtp = "Enter the outgoing mail server and its port.";
  if (!d.user.trim()) problem.user = "Enter the user name to sign in with.";
  if (Object.keys(problem).length) return { ok: false, problem };
  return {
    ok: true,
    fields: {
      imapHost: d.imapHost.trim(),
      imapPort: portOf(d.imapPort),
      imapSecurity: d.imapSecurity,
      smtpHost: d.smtpHost.trim(),
      smtpPort: portOf(d.smtpPort),
      smtpSecurity: d.smtpSecurity,
      user: d.user.trim(),
    },
  };
}

/** Whether the draft differs from what is saved. */
export const sameServers = (a: ServerDraft, b: ServerDraft) =>
  (Object.keys(a) as (keyof ServerDraft)[]).every((k) => a[k].trim() === b[k].trim());

/** Where the server's refusal belongs: the password, the server fields, or the form as a whole. Its sentence is already safe to show. */
export type SaveFailure = {
  field: "password" | "servers" | "form";
  message: string;
};
export function saveFailure(error: unknown): SaveFailure {
  if (!(error instanceof ApiError))
    return {
      field: "form",
      message: error instanceof Error ? error.message : "Something went wrong.",
    };
  const fix = typeof error.details.fix === "string" ? ` ${error.details.fix}` : "";
  const message = `${error.message}${fix}`;
  if (error.code === "AUTH") return { field: "password", message };
  if (["UNREACHABLE", "TIMEOUT", "BLOCKED_URL"].includes(error.code))
    return { field: "servers", message };
  return { field: "form", message };
}

const SECURITY = [
  { value: "tls", label: "TLS (usually port 993 or 465)" },
  { value: "starttls", label: "STARTTLS (usually port 143 or 587)" },
];

/** The two servers and the user name. The sentences under a field are the server's own safe sentences. */
export function ServerFieldset({
  draft,
  onChange,
  problem,
  serversError,
}: {
  draft: ServerDraft;
  onChange: (patch: Partial<ServerDraft>) => void;
  problem?: ServerProblem;
  serversError?: string;
}) {
  return (
    <div className="space-y-4">
      <fieldset className="grid gap-3 sm:grid-cols-[1fr_6rem_14rem]">
        <legend className="mb-2 text-sm font-medium">Incoming mail (IMAP)</legend>
        <Input
          title="Server"
          name="imapHost"
          autoComplete="off"
          value={draft.imapHost}
          error={problem?.imap ?? serversError}
          onChange={(e) => onChange({ imapHost: e.target.value })}
        />
        <Input
          title="Port"
          name="imapPort"
          inputMode="numeric"
          value={draft.imapPort}
          onChange={(e) => onChange({ imapPort: e.target.value })}
        />
        <Select
          title="Security"
          name="imapSecurity"
          required={false}
          value={draft.imapSecurity}
          options={SECURITY}
          onChange={(e) => onChange({ imapSecurity: e.target.value as MailSecurity })}
        />
      </fieldset>
      <fieldset className="grid gap-3 sm:grid-cols-[1fr_6rem_14rem]">
        <legend className="mb-2 text-sm font-medium">Outgoing mail (SMTP)</legend>
        <Input
          title="Server"
          name="smtpHost"
          autoComplete="off"
          value={draft.smtpHost}
          error={problem?.smtp}
          onChange={(e) => onChange({ smtpHost: e.target.value })}
        />
        <Input
          title="Port"
          name="smtpPort"
          inputMode="numeric"
          value={draft.smtpPort}
          onChange={(e) => onChange({ smtpPort: e.target.value })}
        />
        <Select
          title="Security"
          name="smtpSecurity"
          required={false}
          value={draft.smtpSecurity}
          options={SECURITY}
          onChange={(e) => onChange({ smtpSecurity: e.target.value as MailSecurity })}
        />
      </fieldset>
      <Input
        title="User name"
        name="user"
        autoComplete="off"
        value={draft.user}
        error={problem?.user}
        onChange={(e) => onChange({ user: e.target.value })}
      />
    </div>
  );
}
