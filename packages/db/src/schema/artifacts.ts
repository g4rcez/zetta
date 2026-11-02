import { sql } from "drizzle-orm";
import { bigint, check, index, text, timestamp, uuid } from "drizzle-orm/pg-core";
import { zetta } from "./pg-schema";

import { user } from "./auth";
import { bot, conversation } from "./chat";
import { routineRun } from "./features";
import { searchVector } from "./search";

const restrict = { onDelete: "restrict", onUpdate: "restrict" } as const;
const setNull = { onDelete: "set null", onUpdate: "restrict" } as const;

/** What the preview page draws. The server derives it from the mime type and the file extension. */
export const ARTIFACT_KINDS = [
  "html",
  "markdown",
  "text",
  "code",
  "csv",
  "json",
  "image",
  "video",
  "audio",
  "pdf",
  "zip",
  "binary",
] as const;
export type ArtifactKind = (typeof ARTIFACT_KINDS)[number];

/**
 * A file a bot delivered (a report, a deck, a video, a zip). The bytes live on disk at `<artifacts root>/<owner>/<sha256>`;
 * the row holds the metadata. Deleting the bot, the chat or the routine run only unlinks it.
 */
export const artifact = zetta.table(
  "artifact",
  {
    id: uuid("id")
      .primaryKey()
      .default(sql`uuidv7()`),
    ownerUserId: text("owner_user_id")
      .notNull()
      .references(() => user.id, restrict),
    botId: uuid("bot_id").references(() => bot.id, setNull),
    conversationId: uuid("conversation_id").references(() => conversation.id, setNull),
    routineRunId: uuid("routine_run_id").references(() => routineRun.id, setNull),
    title: text("title").notNull(),
    description: text("description").default("").notNull(),
    fileName: text("file_name").notNull(),
    mimeType: text("mime_type").notNull(),
    kind: text("kind", { enum: ARTIFACT_KINDS }).notNull(),
    size: bigint("size", { mode: "number" }).notNull(),
    sha256: text("sha256").notNull(),
    /** Set when the user pinned it; pinned artifacts list first. */
    pinnedAt: timestamp("pinned_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).defaultNow().notNull(),
  },
  (t) => [
    index("artifact_owner_created_idx").on(t.ownerUserId, t.createdAt.desc()),
    index("artifact_bot_id_idx").on(t.botId),
    index("artifact_search_idx").using(
      "gin",
      searchVector(sql`${t.title} || ' ' || ${t.description} || ' ' || ${t.fileName}`),
    ),
    index("artifact_conversation_id_idx").on(t.conversationId),
    index("artifact_routine_run_id_idx").on(t.routineRunId),
    check("artifact_title_check", sql`length(btrim(${t.title})) between 1 and 200`),
    check("artifact_size_check", sql`${t.size} >= 0`),
  ],
);
