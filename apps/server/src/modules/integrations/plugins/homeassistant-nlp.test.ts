import { describe, expect, test } from "bun:test";
import type { HomeCatalog, HomeEntity } from "./homeassistant-catalog";
import { fuzzy, target } from "./homeassistant-fuzzy";
import { parseHomeCommand } from "./homeassistant-nlp";

/** A made-up home: the names mix English and Portuguese, as real ones do. */
const entity = (id: string, name: string, extra: Partial<HomeEntity> = {}): HomeEntity => ({
  id,
  domain: id.split(".")[0]!,
  name,
  state: "off",
  features: 0,
  attrs: {},
  ...extra,
});
const DIMMER = { supported_color_modes: ["color_temp", "hs"] };
const catalog: HomeCatalog = {
  at: 0,
  services: {},
  entities: [
    entity("light.neo_40w", "Lâmpada NEO 40W", { area: "Sala", attrs: DIMMER }),
    entity("light.neo_60w", "Lâmpada NEO 60W", { area: "Quarto", attrs: DIMMER }),
    entity("light.escritorio", "Escritório", { attrs: DIMMER }),
    entity("light.kitchen", "Kitchen light", { area: "Cozinha", attrs: DIMMER }),
    entity("media_player.tv", "Living TV", {
      area: "Sala",
      // turn on 128, turn off 256, pause 1, volume set 4, mute 8, volume step 1024, source 2048, play 16384
      features: 128 + 256 + 1 + 4 + 8 + 1024 + 2048 + 16384,
      attrs: { source_list: ["HDMI 1", "Netflix"] },
    }),
    entity("scene.movie", "Movie night"),
    entity("climate.thermostat", "Thermostat", {
      features: 1 + 128 + 256,
      attrs: { hvac_modes: ["off", "heat", "cool"], min_temp: 16, max_temp: 30 },
    }),
    entity("lock.front_door", "Front door"),
    entity("cover.blinds", "Living blinds", { area: "Sala", features: 1 + 2 + 4 + 8 }),
    entity("fan.bedroom", "Bedroom fan", { area: "Quarto" }),
    entity("sensor.temp", "Temperature", { area: "Sala" }),
  ],
};

const parse = (text: string, languages: string[] = ["en", "pt-BR"]) => {
  const r = parseHomeCommand(text, catalog, languages);
  return r && { id: r.entity.id, action: r.action.key, data: r.data, lang: r.lang };
};

describe("parseHomeCommand: what it understands", () => {
  test.each([
    // Portuguese: the lamp, in every way a person writes its name
    ["Acenda a luz Neo 40W", "light.neo_40w", "turn_on", {}, "pt"],
    ["Apague a luz Neo 40W", "light.neo_40w", "turn_off", {}, "pt"],
    ["Ligue a lâmpada Neo 40W", "light.neo_40w", "turn_on", {}, "pt"],
    ["Desligue a Neo 40W", "light.neo_40w", "turn_off", {}, "pt"],
    ["Acenda a Neo40W", "light.neo_40w", "turn_on", {}, "pt"],
    ["acenda a lampada neo40w", "light.neo_40w", "turn_on", {}, "pt"],
    ["ACENDA A LUZ NEO 40W", "light.neo_40w", "turn_on", {}, "pt"],
    ["Acenda a luz NEO 40 W", "light.neo_40w", "turn_on", {}, "pt"],
    ["Ligue a luz neo40", "light.neo_40w", "turn_on", {}, "pt"],
    ["Ligue a lampda neo40w", "light.neo_40w", "turn_on", {}, "pt"],
    ["Acenda a luz neo 60w", "light.neo_60w", "turn_on", {}, "pt"],
    ["Por favor, apague a luz Neo 40W", "light.neo_40w", "turn_off", {}, "pt"],
    ["Pode ligar a luz Neo 40W?", "light.neo_40w", "turn_on", {}, "pt"],
    ["Alterne a luz Neo 40W", "light.neo_40w", "toggle", {}, "pt"],
    ["Deixe a luz Neo 40W em 30%", "light.neo_40w", "set_brightness", { brightness_pct: 30 }, "pt"],
    [
      "Ajuste a Neo 40W para 80 por cento",
      "light.neo_40w",
      "set_brightness",
      { brightness_pct: 80 },
      "pt",
    ],
    ["A luz Neo 40W está acesa?", "light.neo_40w", "state", {}, "pt"],
    ["A Neo 40W está ligada?", "light.neo_40w", "state", {}, "pt"],
    ["Qual o estado da luz Neo 40W?", "light.neo_40w", "state", {}, "pt"],
    ["Acenda a luz da sala", "light.neo_40w", "turn_on", {}, "pt"],
    // English
    ["Turn on Neo40W", "light.neo_40w", "turn_on", {}, "en"],
    ["Turn off Neo 40W", "light.neo_40w", "turn_off", {}, "en"],
    ["Turn the Neo 40W light on", "light.neo_40w", "turn_on", {}, "en"],
    ["Please switch off the Neo 40W lamp", "light.neo_40w", "turn_off", {}, "en"],
    ["Toggle Neo 40W", "light.neo_40w", "toggle", {}, "en"],
    ["Set Neo 40W to 30%", "light.neo_40w", "set_brightness", { brightness_pct: 30 }, "en"],
    [
      "Dim the Neo 40W light to 20",
      "light.neo_40w",
      "set_brightness",
      { brightness_pct: 20 },
      "en",
    ],
    ["Is Neo 40W on?", "light.neo_40w", "state", {}, "en"],
    ["is the neo40w light on", "light.neo_40w", "state", {}, "en"],
    ["Can you turn on the Neo 40W light?", "light.neo_40w", "turn_on", {}, "en"],
    ["what is the state of neo 40w", "light.neo_40w", "state", {}, "en"],
    // other lights, by name and by area
    ["Acenda a luz do escritório", "light.escritorio", "turn_on", {}, "pt"],
    ["Apague a luz do escritório", "light.escritorio", "turn_off", {}, "pt"],
    ["Desligue a luz do escritório", "light.escritorio", "turn_off", {}, "pt"],
    [
      "Aumente o brilho do escritório para 70%",
      "light.escritorio",
      "set_brightness",
      { brightness_pct: 70 },
      "pt",
    ],
    ["A luz do escritório está acesa?", "light.escritorio", "state", {}, "pt"],
    ["Turn off the kitchen light", "light.kitchen", "turn_off", {}, "en"],
    ["Turn on the light in the kitchen", "light.kitchen", "turn_on", {}, "en"],
    ["Acenda a luz da cozinha", "light.kitchen", "turn_on", {}, "pt"],
    // TV
    ["Ligue a TV", "media_player.tv", "turn_on", {}, "pt"],
    ["Desligue a TV da sala", "media_player.tv", "turn_off", {}, "pt"],
    ["Coloque o volume da TV em 30", "media_player.tv", "set_volume", { volume_level: 0.3 }, "pt"],
    ["Set the TV volume to 30", "media_player.tv", "set_volume", { volume_level: 0.3 }, "en"],
    ["Turn up the TV", "media_player.tv", "volume_up", {}, "en"],
    ["Aumente o volume da TV", "media_player.tv", "volume_up", {}, "pt"],
    ["Mute the TV", "media_player.tv", "mute", { is_volume_muted: true }, "en"],
    ["Silencie a TV", "media_player.tv", "mute", { is_volume_muted: true }, "pt"],
    ["Pause the TV", "media_player.tv", "pause", {}, "en"],
    ["Mude a TV para Netflix", "media_player.tv", "select_source", { source: "Netflix" }, "pt"],
    [
      "Change the TV input to HDMI 1",
      "media_player.tv",
      "select_source",
      { source: "HDMI 1" },
      "en",
    ],
    ["Qual o volume da TV?", "media_player.tv", "state", {}, "pt"],
    ["Is the TV on?", "media_player.tv", "state", {}, "en"],
    // scene, climate, lock, cover, fan
    ["Ative a cena Movie night", "scene.movie", "activate", {}, "pt"],
    ["Activate the movie night scene", "scene.movie", "activate", {}, "en"],
    ["Run movie night", "scene.movie", "activate", {}, "en"],
    [
      "Ajuste o termostato para 22 graus",
      "climate.thermostat",
      "set_temperature",
      { temperature: 22 },
      "pt",
    ],
    [
      "Set the thermostat to 22",
      "climate.thermostat",
      "set_temperature",
      { temperature: 22 },
      "en",
    ],
    ["Set the thermostat to cool", "climate.thermostat", "set_mode", { hvac_mode: "cool" }, "en"],
    ["Lock the front door", "lock.front_door", "lock", {}, "en"],
    ["Unlock the front door", "lock.front_door", "unlock", {}, "en"],
    ["Tranque a fechadura", "lock.front_door", "lock", {}, "pt"],
    ["Abra a persiana da sala", "cover.blinds", "open", {}, "pt"],
    ["Feche as persianas", "cover.blinds", "close", {}, "pt"],
    ["Ajuste a persiana para 50%", "cover.blinds", "set_position", { position: 50 }, "pt"],
    ["Ligue o ventilador do quarto", "fan.bedroom", "turn_on", {}, "pt"],
  ] as const)("%s", (text, id, action, data, lang) => {
    expect(parse(text)).toEqual({ id, action, data, lang });
  });
});

describe("parseHomeCommand: what it refuses to guess", () => {
  test.each([
    // negation and two commands
    "Não acenda a luz Neo 40W",
    "Don't turn off the kitchen light",
    "Acenda a luz Neo 40W e apague a luz do escritório",
    "Acenda apague a luz Neo 40W",
    // not a command
    "Escreva um script para ligar a luz do escritório",
    "How do I turn off a light in Python?",
    "Turn on the thing",
    "turn it off",
    "Ligue",
    // unknown or ambiguous device
    "Acenda a luz do banheiro",
    "Acenda a luz neo",
    "Acenda a luz",
    "Turn on the lights",
    // an action the device does not have, a value that does not fit
    "Aumente o volume da Neo 40W",
    "Ajuste o brilho da Neo 40W para 150",
    "Set the thermostat to 50",
    "Abaixe o volume",
    "Open the blinds to 50%",
    // Spanish is not supported
    "Apaga la luz de la oficina",
    // too long to be a command
    "Please turn on the kitchen light and then tell me what the weather is like tomorrow morning in the city",
  ])("%s", (text) => {
    expect(parse(text)).toBeUndefined();
  });
});

describe("parseHomeCommand: the reply language", () => {
  test("a tie follows the installation's first language", () => {
    expect(parse("Neo 40W on", ["pt-BR", "en"])).toBeUndefined();
    expect(parse("Turn on the TV", ["pt-BR", "en"])?.lang).toBe("en");
    expect(parse("Ligue a TV", ["en"])?.lang).toBe("pt");
  });
});

describe("fuzzy: case, accents and spaces do not matter", () => {
  const name = target("Lâmpada NEO 40W");
  test.each([
    ["neo40w", { score: 1, runs: 1 }],
    ["Neo 40W", { score: 1, runs: 1 }],
    ["LAMPADANEO40W", { score: 1, runs: 1 }],
    ["lâmpada neo 40w", { score: 1, runs: 1 }],
  ])("%s", (query, expected) => {
    expect(fuzzy(query, name)).toEqual(expected);
  });

  test("a query with a missing letter still finds the name, in two pieces", () => {
    expect(fuzzy("lampda neo40w", name)?.runs).toBe(2);
  });

  test("a character that is not in the name is no match", () => {
    expect(fuzzy("neo50w", name)).toBeUndefined();
    expect(fuzzy("", name)).toBeUndefined();
  });
});
