import {
  PLAYGROUND_INPUT_TYPES,
  PLAYGROUND_LANGUAGES,
  PLAYGROUND_RUNNERS,
  PLAYGROUND_VISIBILITIES,
} from "@zetta/db/schema/playground";
import { z } from "zod";
import { PLAYGROUND_LIMITS } from "./languages";

/** The input checks of a playground, shared by the routes and the bot tool. Light on purpose: `chat/tools.ts` imports it. */
export const FILE_PATH = z
  .string()
  .min(1)
  .max(300)
  .refine(
    // oxlint-disable-next-line no-control-regex -- the control characters are what this pattern refuses
    (p) => !/[\u0000-\u001f\\]/.test(p),
    "A file path has no control characters or backslashes.",
  )
  .refine(
    (p) => !p.startsWith("/") && !p.split("/").some((s) => s === ".." || s === "." || s === ""),
    "A file path is relative and has no `..`.",
  )
  .refine(
    (p) => p !== "out" && !p.startsWith("out/"),
    "`out/` holds the files a script writes. Use another folder.",
  )
  .refine((p) => p !== "inputs.json", "`inputs.json` holds the inputs of a run. Use another name.");

export const inputSpec = z.strictObject({
  name: z
    .string()
    .regex(
      /^[A-Za-z_][A-Za-z0-9_]{0,39}$/,
      "An input name is a letter or _ followed by letters, digits or _ (40 at most).",
    ),
  label: z.string().trim().max(80).optional(),
  type: z.enum(PLAYGROUND_INPUT_TYPES),
  default: z.unknown().optional(),
});

export const playgroundFields = z.strictObject({
  title: z.string().trim().min(1, "Give the playground a title.").max(120),
  language: z.enum(PLAYGROUND_LANGUAGES),
  runner: z.enum(PLAYGROUND_RUNNERS).optional(),
  entry: FILE_PATH.optional(),
  files: z
    .array(z.strictObject({ path: FILE_PATH, content: z.string() }))
    .min(1, "Add at least one file.")
    .max(PLAYGROUND_LIMITS.files, `A playground has ${PLAYGROUND_LIMITS.files} files at most.`),
  inputs: z.array(inputSpec).max(30).optional(),
  visibility: z.enum(PLAYGROUND_VISIBILITIES).optional(),
});
export type PlaygroundFields = z.infer<typeof playgroundFields>;
export const playgroundPatch = playgroundFields.partial();
export type PlaygroundPatch = z.infer<typeof playgroundPatch>;
