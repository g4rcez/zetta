import type { bot } from "@zetta/db/schema/chat";

/**
 * The configuration a bot revision keeps, so "restore this version" brings back the whole bot. The chat service writes a revision when a
 * bot is edited, and the organization chart writes one when it shares a bot with the team; both read the same fields from here.
 */
export const snapshotBotConfig = (r: typeof bot.$inferSelect) => ({
  name: r.name,
  description: r.description,
  harness: r.harness,
  model: r.model,
  personality: r.personality,
  instructions: r.instructions,
  outputStyle: r.outputStyle,
  outputStyleId: r.outputStyleId,
  visibility: r.visibility,
  // Added 2026-11-15 so "restore this version" brings back the whole configuration, not only the text. Older revisions lack them.
  fallbackHarness: r.fallbackHarness,
  fallbackModel: r.fallbackModel,
  computerMode: r.computerMode,
  autoLearn: r.autoLearn,
  codeAccess: r.codeAccess,
  commitIdentity: r.commitIdentity,
  commitEmail: r.commitEmail,
  contextBytes: r.contextBytes,
  // Added 2026-11-15 with the chat memory controls.
  summaryMode: r.summaryMode,
  summaryMaxChars: r.summaryMaxChars,
  summaryGapBytes: r.summaryGapBytes,
  chatSearchLimit: r.chatSearchLimit,
  // Added with spoken calls (2026-11-23). Older revisions lack them.
  voice: r.voice,
  voiceLanguage: r.voiceLanguage,
});
