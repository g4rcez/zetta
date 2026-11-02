import { expect, test } from "bun:test";
import { assertActivationCatalog, verifyActivationSources } from "./identity-activation-proof";
test("pinned asymmetric feature tree selects only the two new migrations", async () => {
  await expect(verifyActivationSources()).resolves.toBeUndefined();
});
test("catalog oracle rejects each missing fact and unknown fields (synthetic protocol only)", () => {
  const valid = { column_ok: true, check_ok: true, function_ok: true, trigger_ok: true };
  expect(() => assertActivationCatalog(valid)).not.toThrow();
  for (const key of Object.keys(valid))
    expect(() => assertActivationCatalog({ ...valid, [key]: false })).toThrow(
      "Identity activation proof unavailable.",
    );
  for (const raw of [null, [], {}, { ...valid, extra: true }, { ...valid, column_ok: "true" }])
    expect(() => assertActivationCatalog(raw)).toThrow("Identity activation proof unavailable.");
});
test("pure manifest comparison rejects tampered hashes and baseline SQL without changing accepted artifacts", async () => {
  const { assertActivationManifest } = await import("./identity-activation-proof");
  const { readdir, readFile } = await import("node:fs/promises");
  const { createHash } = await import("node:crypto");
  const folder = new URL("../identity-activation-test-migrations/", import.meta.url);
  const actual: { name: string; files: { name: string; hash: string }[] }[] = [];
  for (const name of (await readdir(folder)).sort()) {
    const files = [];
    for (const file of (await readdir(new URL(`${name}/`, folder))).sort())
      files.push({
        name: file,
        hash: createHash("sha256")
          .update(await readFile(new URL(`${name}/${file}`, folder)))
          .digest("hex"),
      });
    actual.push({ name, files });
  }
  expect(() => assertActivationManifest(actual)).not.toThrow();
  for (let i = 0; i < actual.length; i++) {
    const entry = actual[i];
    if (!entry) throw new Error("Missing artifact");
    for (let j = 0; j < entry.files.length; j++) {
      const changed = actual.map((m, mi) => ({
        ...m,
        files: m.files.map((f, fi) => (mi === i && fi === j ? { ...f, hash: "0".repeat(64) } : f)),
      }));
      expect(() => assertActivationManifest(changed)).toThrow(
        "Identity activation proof unavailable.",
      );
    }
  }
  for (const raw of [
    actual.slice(1),
    [...actual].reverse(),
    [...actual, actual[0]],
    actual.map((m, i) =>
      i ? m : { ...m, files: [...m.files, { name: "migration.sql", hash: "0".repeat(64) }] },
    ),
    null,
    1n,
  ])
    expect(() => assertActivationManifest(raw)).toThrow("Identity activation proof unavailable.");
});
test("both entries retain private fresh setup and layer before returning, without caller hooks", async () => {
  const source = await Bun.file(new URL("./identity-proof-client.ts", import.meta.url)).text();
  expect(source).toContain("openIdentityProofCore(connectionString, false)");
  expect(source).toContain("openIdentityProofCore(connectionString, true)");
  expect(source).not.toContain("export async function openIdentityProofCore");
  expect(source.indexOf("check(objects.rowCount === 0)")).toBeLessThan(
    source.indexOf("await seedIdentityActivationBackfill(owner)"),
  );
  expect(source.indexOf("await migrate(databases[0]!")).toBeLessThan(
    source.indexOf("await seedIdentityActivationBackfill(owner)"),
  );
  expect(source.indexOf("await applyIdentityActivation(owner)")).toBeLessThan(
    source.indexOf("return { owner,"),
  );
  expect(source.indexOf("await verifyIdentityActivationBackfill(owner)")).toBeLessThan(
    source.indexOf("return { owner,"),
  );
  expect(source).toContain("await close();");
});
test("proof helpers import inertly with all timer and network startup trapped in a fresh process", async () => {
  const child = Bun.spawn(
    [
      process.execPath,
      "--no-env-file",
      "--eval",
      `
    import net from 'node:net'; import tls from 'node:tls';
    const deny=()=>{throw Error('Unexpected startup')};
    net.Socket.prototype.connect=deny;tls.connect=deny;globalThis.fetch=deny;Bun.connect=deny;Bun.serve=deny;
    globalThis.setTimeout=deny;globalThis.setInterval=deny;
    const m=await import(${JSON.stringify(new URL("./identity-proof-client.ts", import.meta.url).href)});
    if(typeof m.openIdentityProof!=='function'||typeof m.openIdentityActivationBackfillProof!=='function'||typeof m.openIdentityActivationExhaustionProof!=='function')throw Error('Missing entry');
    await import(${JSON.stringify(new URL("./run-readback-proof-client.ts", import.meta.url).href)});
    console.log('PASS inert imports');
  `,
    ],
    { env: {}, stdout: "pipe", stderr: "pipe", timeout: 5000 },
  );
  const [code, out, err] = await Promise.all([
    child.exited,
    new Response(child.stdout).text(),
    new Response(child.stderr).text(),
  ]);
  expect({ code, out, err }).toEqual({ code: 0, out: "PASS inert imports\n", err: "" });
});
test("fixed exhaustion entry applies only pinned delta before seed and full guards before returning", async () => {
  const core = await Bun.file(new URL("./identity-proof-client.ts", import.meta.url)).text();
  const helper = await Bun.file(new URL("./identity-activation-proof.ts", import.meta.url)).text();
  expect(core).toContain(
    "export async function openIdentityActivationExhaustionProof(connectionString: string)",
  );
  expect(core).toContain("openIdentityProofCore(connectionString, false, true)");
  expect(core.indexOf("await seedIdentityActivationExhaustion(owner)")).toBeGreaterThan(
    core.indexOf("await migrate(databases[0]!"),
  );
  expect(core.indexOf("await seedIdentityActivationExhaustion(owner)")).toBeLessThan(
    core.indexOf("await applyIdentityActivation(owner)"),
  );
  expect(core.indexOf("await verifyIdentityActivationExhaustion(owner)")).toBeGreaterThan(
    core.indexOf("await applyIdentityActivation(owner)"),
  );
  expect(core.indexOf("await verifyIdentityActivationExhaustion(owner)")).toBeLessThan(
    core.indexOf("return { owner,"),
  );
  const branch = helper.slice(
    helper.indexOf("export async function seedIdentityActivationExhaustion"),
  );
  expect(branch.indexOf("await verifyActivationSources()")).toBeLessThan(
    branch.indexOf("readMigrationFiles("),
  );
  expect(branch).toContain(
    "await migrateSelected([delta], drizzle({ client, logger: false }), { migrationsFolder: folder })",
  );
  expect(branch.indexOf("check(precondition?.ready)")).toBeLessThan(
    branch.indexOf('insert into zetta."user"'),
  );
  expect(branch).toContain("2147483647");
  expect(branch).not.toMatch(
    /activation-legacy-|DISABLE|session_replication_role|insert into drizzle|ALTER TABLE|UPDATE zetta.membership/i,
  );
});
