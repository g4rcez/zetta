import { PluginError, type PluginContext } from "../registry";
import { readableType, readFileText } from "./drive";
import { gfetch, needScope, settings } from "./oauth";

/** What indexing needs from Drive: metadata, the change feed and a way to read one file. All calls run as the connected user. */
export type DriveFile = {
  id: string;
  name: string;
  mimeType: string;
  version: string;
  modifiedAt: Date | null;
  webViewLink: string | null;
  size: number;
};
export type DriveChange = { fileId: string; removed: boolean; file: DriveFile | null };

const FIELDS = "id,name,mimeType,modifiedTime,version,webViewLink,size,trashed";
type Raw = {
  id: string;
  name?: string;
  mimeType?: string;
  modifiedTime?: string;
  version?: string;
  webViewLink?: string;
  size?: string;
  trashed?: boolean;
};
const file = (f: Raw): DriveFile => ({
  id: f.id,
  name: (f.name ?? "").slice(0, 300),
  mimeType: f.mimeType ?? "",
  version: f.version ?? "",
  modifiedAt: f.modifiedTime ? new Date(f.modifiedTime) : null,
  webViewLink: f.webViewLink ?? null,
  size: Number(f.size ?? 0),
});
const url = (path: string, params: Record<string, string>) => {
  const u = new URL(`${settings().driveBase}${path}`);
  for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v);
  return u.toString();
};

/** Indexing reads whole files, so it needs `drive.readonly`: the narrower `drive.file` scope only sees files the app created. */
export const needIndexScope = (ctx: PluginContext) => needScope(ctx, "drive.readonly");
export const indexable = (f: DriveFile) => readableType(f.mimeType);

export async function startPageToken(ctx: PluginContext): Promise<string> {
  const j = (await (await gfetch(ctx, url("/changes/startPageToken", {}))).json()) as {
    startPageToken?: string;
  };
  if (!j.startPageToken) throw new PluginError("GOOGLE_ERROR", "Google could not complete that.");
  return j.startPageToken;
}

/** One page of every readable, not trashed file the user can open (their own and shared with them). */
export async function listFiles(
  ctx: PluginContext,
  pageToken?: string,
): Promise<{ files: DriveFile[]; next: string | null }> {
  const readable = [
    "application/vnd.google-apps.document",
    "application/vnd.google-apps.presentation",
    "application/vnd.google-apps.spreadsheet",
  ]
    .map((t) => `mimeType = '${t}'`)
    .concat("mimeType contains 'text/'")
    .join(" or ");
  const j = (await (
    await gfetch(
      ctx,
      url("/files", {
        q: `trashed = false and (${readable})`,
        pageSize: "100",
        fields: `nextPageToken,files(${FIELDS})`,
        ...(pageToken ? { pageToken } : {}),
      }),
    )
  ).json()) as { files?: Raw[]; nextPageToken?: string };
  return { files: (j.files ?? []).map(file), next: j.nextPageToken ?? null };
}

/** One page of the change feed from `pageToken`. `newStart` is set on the last page: store it for the next run. */
export async function listChanges(
  ctx: PluginContext,
  pageToken: string,
): Promise<{ changes: DriveChange[]; next: string | null; newStart: string | null }> {
  const j = (await (
    await gfetch(
      ctx,
      url("/changes", {
        pageToken,
        pageSize: "100",
        includeRemoved: "true",
        fields: `nextPageToken,newStartPageToken,changes(fileId,removed,file(${FIELDS}))`,
      }),
    )
  ).json()) as {
    changes?: { fileId: string; removed?: boolean; file?: Raw }[];
    nextPageToken?: string;
    newStartPageToken?: string;
  };
  return {
    changes: (j.changes ?? []).map((c) => ({
      fileId: c.fileId,
      removed: Boolean(c.removed) || Boolean(c.file?.trashed),
      file: c.file ? file(c.file) : null,
    })),
    next: j.nextPageToken ?? null,
    newStart: j.newStartPageToken ?? null,
  };
}

export const readText = (ctx: PluginContext, f: DriveFile, cap: number) =>
  readFileText(ctx, { id: f.id, mimeType: f.mimeType, size: f.size }, cap);

/** Whether the connected user can still open the file. Any failure counts as "no": a citation is only shown when access is confirmed. */
export async function canOpen(ctx: PluginContext, id: string): Promise<boolean> {
  try {
    const f = (await (
      await gfetch(ctx, url(`/files/${encodeURIComponent(id)}`, { fields: "id,trashed" }))
    ).json()) as { trashed?: boolean };
    return !f.trashed;
  } catch {
    return false;
  }
}
