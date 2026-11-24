import { describe, expect, test } from "bun:test";

import { parseVtt, toSrt, toText, toVtt } from "./captions";

const MANUAL = `WEBVTT
Kind: captions
Language: en

00:00:01.000 --> 00:00:03.500 align:start position:0%
Hello &amp; welcome

2
00:01:02.250 --> 00:01:04.000
<i>Second</i> line
`;

// How YouTube's automatic captions really roll: each cue repeats the line before it, and a tiny cue holds only the repetition.
const ROLLING = `WEBVTT

00:00:00.000 --> 00:00:02.000
we are going to talk

00:00:02.000 --> 00:00:02.010
we are going to talk

00:00:02.010 --> 00:00:04.000
we are going to talk
about<00:00:03.000><c> rolling</c><00:00:03.500><c> captions</c>

00:00:04.000 --> 00:00:04.010
about rolling captions

00:00:04.010 --> 00:00:06.000
about rolling captions
and nothing repeats
`;

describe("parseVtt", () => {
  test("reads times, entities, tags and cue numbers", () => {
    const cues = parseVtt(MANUAL);
    expect(cues).toEqual([
      { start: 1, end: 3.5, text: "Hello & welcome" },
      { start: 62.25, end: 64, text: "Second line" },
    ]);
  });

  test("a rolling automatic caption reads once", () => {
    const cues = parseVtt(ROLLING);
    expect(toText(cues)).toBe("we are going to talk\nabout rolling captions\nand nothing repeats");
  });

  test("hours, commas and a file with no cues", () => {
    expect(parseVtt("WEBVTT\n\n01:00:00,500 --> 01:00:01,000\nlate\n")[0]).toEqual({
      start: 3600.5,
      end: 3601,
      text: "late",
    });
    expect(parseVtt("WEBVTT\n\nNOTE nothing here\n")).toEqual([]);
  });
});

describe("formats", () => {
  const cues = [
    { start: 0, end: 30, text: "one" },
    { start: 3661.5, end: 3700, text: "two" },
  ];
  test("srt uses commas and numbers every cue", () => {
    expect(toSrt(cues)).toBe(
      "1\n00:00:00,000 --> 00:00:30,000\none\n\n2\n01:01:01,500 --> 01:01:40,000\ntwo\n",
    );
  });
  test("vtt starts with its header and uses dots", () => {
    expect(toVtt(cues)).toStartWith("WEBVTT\n\n00:00:00.000 --> 00:00:30.000\none\n");
  });
  test("the srt of the vtt reads back to the same cues", () => {
    expect(parseVtt(toVtt(cues))).toEqual(cues);
  });
});
