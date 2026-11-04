import { describe, expect, test } from "bun:test";
import { chmod, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { dockerArgs, runCli } from "./harness";
import { imagePath, saveImage, sniffImage } from "./images";

const png = Uint8Array.from([
  0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0, 0, 0, 13, 73, 72, 68, 82,
]);
const cfg = {
  image: "zetta-harness:latest",
  network: "bridge",
  memory: "1g",
  cpus: "1",
  pids: 256,
  bin: "docker",
};

// Stored paths use the platform separator, and the fake CLI is a shell script.
describe.skipIf(process.platform === "win32")("image uploads", () => {
  test("the type comes from the bytes, not the declared mime type", () => {
    expect(sniffImage(png)).toBe("image/png");
    expect(sniffImage(Uint8Array.from([0xff, 0xd8, 0xff, 0xe0, 0, 0]))).toBe("image/jpeg");
    expect(sniffImage(new TextEncoder().encode("GIF89a......"))).toBe("image/gif");
    expect(sniffImage(new TextEncoder().encode("RIFF....WEBPVP8 "))).toBe("image/webp");
    expect(sniffImage(new TextEncoder().encode("<svg onload=alert(1)>"))).toBeUndefined();
    expect(sniffImage(new TextEncoder().encode("just text"))).toBeUndefined();
  });
  test("a picture is stored once, per user, and kept at a stable path", async () => {
    const root = await mkdtemp(join(tmpdir(), "zetta-att-"));
    const a = await saveImage("user/1", png, "image/png", root);
    const b = await saveImage("user/1", png, "image/png", root);
    expect(b.rel).toBe(a.rel);
    expect(a.rel.startsWith("user_1/")).toBe(true);
    expect(new Uint8Array(await readFile(imagePath(a.rel, root)))).toEqual(png);
    expect((await saveImage("other", png, "image/png", root)).rel).not.toBe(a.rel);
  });
  test("a path can never leave the attachments root", () => {
    expect(() => imagePath("../../etc/passwd", "/data/att")).toThrow();
    expect(() => imagePath("/etc/passwd", "/data/att")).toThrow();
  });
  test("a container gets pictures through their own read-only mount", () => {
    const a = dockerArgs(cfg, {
      name: "n",
      argv: ["claude", "-p", "x"],
      imageDir: "/tmp/zetta-img-1",
      env: {},
    });
    expect(a).toContain("/tmp/zetta-img-1:/zetta-images:ro");
  });
  test("the harness finds the pictures next to its working directory and the prompt names them", async () => {
    const root = await mkdtemp(join(tmpdir(), "zetta-att-"));
    const { rel } = await saveImage("u1", png, "image/png", root);
    const fake = join(await mkdtemp(join(tmpdir(), "zetta-fake-")), "fake-cli");
    await writeFile(
      fake,
      '#!/bin/sh\nfor a in "$@"; do last="$a"; done\nls .zetta-images\nprintf "%s" "$last"\n',
    );
    await chmod(fake, 0o755);
    const out = await runCli({
      harness: "pi",
      prompt: "what is this?",
      model: null,
      images: [{ name: "shot one.png", path: imagePath(rel, root) }],
      resolve: () => fake,
    });
    expect(out).toContain("1-shot_one.png");
    expect(out).toContain("what is this?");
    expect(out).toContain("./.zetta-images/1-shot_one.png");
  });
});
