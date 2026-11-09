import { z } from "zod";
import { FILE_PATH } from "../playground/fields";

/** The input checks of the bot tool `zetta:app`. Light on purpose: `chat/tools.ts` imports it. */
export const APP_FILE_LIMIT = 50;
const files = z.array(z.strictObject({ path: FILE_PATH, content: z.string() })).max(APP_FILE_LIMIT);
const ref = z.string().trim().min(1).max(64);

export const appToolFields = z.discriminatedUnion("action", [
  z.strictObject({ action: z.literal("guide") }),
  z.strictObject({
    action: z.literal("create"),
    title: z.string().trim().min(1, "Give the app a title.").max(120),
    description: z.string().trim().max(500).optional(),
    files: files.min(1, "Add at least one file: index.ts (backend) and/or ui/index.html (page)."),
    note: z.string().max(500).optional(),
  }),
  z.strictObject({
    action: z.literal("update"),
    app: ref,
    title: z.string().trim().min(1).max(120).optional(),
    description: z.string().trim().max(500).optional(),
    /** Files to add or replace, by path. The files not named here stay as they are. */
    files: files.optional(),
    /** Paths to delete. */
    remove: z.array(FILE_PATH).max(APP_FILE_LIMIT).optional(),
    note: z.string().max(500).optional(),
  }),
  z.strictObject({ action: z.literal("get"), app: ref }),
  z.strictObject({ action: z.literal("list") }),
  z.strictObject({ action: z.literal("archive"), app: ref }),
]);
export type AppToolArgs = z.infer<typeof appToolFields>;
export type AppWriteArgs = Extract<AppToolArgs, { action: "create" | "update" }>;
