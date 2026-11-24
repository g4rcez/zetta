/**
 * Added to the bot's prompt for a turn that starts from something the person said aloud. It is a hint about the place, not a new
 * personality: the bot keeps its own memory, instructions and tools. Kept short: it is paid on every spoken turn.
 */
export const VOICE_PROMPT_MAX = 600;

const EN =
  "This message was spoken aloud and your answer will be read aloud. Answer in plain sentences a person can listen to: no markdown, no " +
  "lists with symbols, no tables, no code, no long links. If the answer needs code, a table or a long list, put it in the chat text and say " +
  "in one sentence that you left it there. Before any work that takes more than a few seconds, say one short sentence first.";

export const voiceAddendum = (language?: string): string => {
  const base = EN;
  const note =
    language && !/^en/i.test(language)
      ? ` Answer in the language the person spoke (${language}).`
      : "";
  return `[Spoken turn] ${base}${note}`.slice(0, VOICE_PROMPT_MAX);
};
