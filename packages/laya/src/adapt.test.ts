import { describe, expect, test } from "bun:test";
import { actProbabilities, floatLogits, normalizeConfig } from "./adapt";
import { VARIANTS } from "./variants";

describe("config of each checkpoint", () => {
  test("English: laya_config.json is used as it is", () => {
    expect(
      normalizeConfig("english", {
        max_len: 512,
        head_max_len: 192,
        temperature: [1, 1.2, 0.9],
        temperature_by_options: { "choice:2": 0.8 },
      }),
    ).toEqual({
      max_len: 512,
      head_max_len: 192,
      temperature: [1, 1.2, 0.9],
      temperature_by_options: { "choice:2": 0.8 },
    });
  });
  test("Multilingual: the laya section of config.json, other keys ignored", () => {
    const raw = {
      hidden_size: 768,
      laya: {
        max_len: 1024,
        head_max_len: 256,
        max_option_tokens: 48,
        temperature: [1, 1, 1],
        temperature_by_options: {},
        temperature_clamp: [0.5, 5],
      },
    };
    expect(normalizeConfig("multilingual", raw)).toEqual({
      max_len: 1024,
      head_max_len: 256,
      temperature: [1, 1, 1],
      temperature_by_options: {},
    });
  });
  test("a config without the laya section, or without lengths, is refused", () => {
    expect(() => normalizeConfig("multilingual", { hidden_size: 768 })).toThrow('under "laya"');
    expect(() => normalizeConfig("english", { max_len: 512, temperature: [1, 1, 1] })).toThrow(
      "invalid english config",
    );
    expect(() =>
      normalizeConfig("english", { max_len: 512, head_max_len: 192, temperature: [1, 1] }),
    ).toThrow("invalid english config");
  });
});

describe("outputs", () => {
  test("act_probs: first column of each row", () => {
    expect(
      actProbabilities(
        "act_probs",
        { data: new Float32Array([0.75, 0.25, 0.5, 0.5]), dims: [2, 2] },
        2,
      ),
    ).toEqual([0.75, 0.5]);
  });
  test("act_logits: softmax of each row, first column", () => {
    const [a, b] = actProbabilities(
      "act_logits",
      { data: new Float32Array([0, 0, 2, 0]), dims: [2, 2] },
      2,
    );
    expect(a).toBeCloseTo(0.5, 6);
    expect(b).toBeCloseTo(0.8808, 4);
  });
  test("a missing or non-float32 output is refused", () => {
    expect(() => actProbabilities("act_logits", undefined, 1)).toThrow(
      "act_logits must be float32",
    );
    expect(() =>
      actProbabilities("act_probs", { data: new Uint16Array(2), dims: [1, 2] }, 1),
    ).toThrow("act_probs must be float32");
    expect(() => floatLogits(new Uint16Array(2))).toThrow("logits must be float32");
    expect(floatLogits(new Float32Array(2))).toBeInstanceOf(Float32Array);
  });
});

describe("variants", () => {
  test("English keeps the bundle files and the cache location it had", () => {
    expect(VARIANTS.english.repo).toBe("receptron/laya-onnx");
    expect(VARIANTS.english.revision).toBe("main");
    expect(VARIANTS.english.files).toEqual([
      "laya.onnx",
      "laya.onnx.data",
      "laya_config.json",
      "tokenizer/tokenizer.json",
      "tokenizer/tokenizer_config.json",
    ]);
  });
  test("Multilingual is pinned to one commit and lists the five files", () => {
    expect(VARIANTS.multilingual.repo).toBe("onnx-community/laya-multilingual-ONNX");
    expect(VARIANTS.multilingual.revision).toMatch(/^[0-9a-f]{40}$/);
    expect(VARIANTS.multilingual.files).toEqual([
      "onnx/model.onnx",
      "onnx/model.onnx_data",
      "config.json",
      "tokenizer.json",
      "tokenizer_config.json",
    ]);
    expect(VARIANTS.multilingual.files).toContain(VARIANTS.multilingual.model);
  });
});
