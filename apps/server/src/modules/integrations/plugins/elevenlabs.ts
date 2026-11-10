import { PluginError, registerPlugin, type PluginContext, type PluginDef } from "./registry";
import { saveOutput } from "./outputs";
import { id, optStr, rest, str } from "./rest";

/**
 * ElevenLabs text-to-speech with the person's API key (https://elevenlabs.io/docs/api-reference). Lists voices, turns text into an
 * mp3 kept in the person's code folder (outputs/elevenlabs/), and reports usage. Base address is fixed.
 */
const API = "https://api.elevenlabs.io/v1";
const headers = (c: PluginContext) => {
  const key = (c.config.apiKey ?? "").trim();
  if (!key)
    throw new PluginError(
      "NOT_CONFIGURED",
      "ElevenLabs has no API key.",
      "Open the plugin and paste your API key.",
    );
  return { "xi-api-key": key };
};
const keyHint = "Create a new key at elevenlabs.io (Profile > API keys) and update the plugin.";
/** Characters per call: long enough for a page, short enough not to spend a month's credits by mistake. */
export const SPEAK_MAX = 5000;

export const elevenlabsPlugin: PluginDef = registerPlugin({
  id: "elevenlabs",
  name: "ElevenLabs",
  description: "Turn text into natural speech with your voices, and check your remaining credits.",
  icon: "waveform",
  category: "other",
  auth: "api-key",
  docsUrl: "https://elevenlabs.io/docs/api-reference/introduction",
  fields: [
    {
      key: "apiKey",
      label: "API key",
      secret: true,
      kind: "password",
      help: "elevenlabs.io > Profile > API keys.",
    },
  ],
  guide: () => [
    "Open elevenlabs.io, then Profile > API keys.",
    "Create a key with text-to-speech and voices read access.",
    "Paste it here.",
  ],
  kind: "native",
  async status(c) {
    const s = (await rest({
      service: "ElevenLabs",
      url: `${API}/user/subscription`,
      headers: headers(c),
      keyHint,
    })) as {
      tier?: string;
    };
    return { state: "connected", info: { plan: s.tier } };
  },
  tools: [
    {
      name: "voices",
      description: "Your voices: id, name, category.",
      effect: "read",
      inputSchema: { type: "object", properties: {} },
      handler: async (c) =>
        (
          (await rest({
            service: "ElevenLabs",
            url: `${API}/voices`,
            headers: headers(c),
            keyHint,
          })) as {
            voices?: { voice_id: string; name: string; category?: string }[];
          }
        ).voices?.map((v) => ({ id: v.voice_id, name: v.name, category: v.category })) ?? [],
    },
    {
      name: "speak",
      description: `Turn text (up to ${SPEAK_MAX} characters) into an mp3 with one of the voices. Saves it in the user's code folder and returns its path.`,
      inputSchema: {
        type: "object",
        properties: {
          voiceId: { type: "string" },
          text: { type: "string" },
          model: { type: "string" },
          name: { type: "string" },
        },
        required: ["voiceId", "text"],
      },
      handler: async (c, a) => {
        const audio = await rest({
          service: "ElevenLabs",
          url: `${API}/text-to-speech/${id(a, "voiceId")}?output_format=mp3_44100_128`,
          method: "POST",
          headers: { ...headers(c), Accept: "audio/mpeg" },
          body: {
            text: str(a, "text", SPEAK_MAX),
            model_id: optStr(a, "model", 60) ?? "eleven_multilingual_v2",
          },
          as: "bytes",
          timeoutMs: 120_000,
          keyHint,
        });
        const path = await saveOutput(
          c.userId,
          "elevenlabs",
          `${optStr(a, "name", 60) ?? "speech"}.mp3`,
          audio,
        );
        return { saved: path, bytes: audio.byteLength };
      },
    },
    {
      name: "usage",
      description: "Characters used and left this period.",
      effect: "read",
      inputSchema: { type: "object", properties: {} },
      handler: async (c) => {
        const s = (await rest({
          service: "ElevenLabs",
          url: `${API}/user/subscription`,
          headers: headers(c),
          keyHint,
        })) as {
          character_count?: number;
          character_limit?: number;
          next_character_count_reset_unix?: number;
        };
        return {
          used: s.character_count,
          limit: s.character_limit,
          resetsAt: s.next_character_count_reset_unix
            ? new Date(s.next_character_count_reset_unix * 1000).toISOString()
            : null,
        };
      },
    },
  ],
});
