import { expect, test } from "bun:test";
import { projectRunProvenanceCatalog } from "../../../../../packages/db/src/run-provenance-proof";

test("catalog projection retains safe false/null facts and bounds expression tokens", () => {
  const safe = "((producer_kindISNULL)OR(producer_kind='fixture'::text))";
  const row = { columns_ok: true, check_ok: false, check_expression: safe, function_ok: null, trigger_ok: true };
  expect(projectRunProvenanceCatalog({ ...row, private: "synthetic-private" })).toEqual(row);
  expect(Object.isFrozen(projectRunProvenanceCatalog(row))).toBe(true);
  for (const value of ["", "synthetic-private", "'secret'", "fixture", `${safe};select`, `${safe}\n`, "1".repeat(2049), 1, {}, null]) {
    expect(projectRunProvenanceCatalog({ ...row, check_expression: value }).check_expression).toBeNull();
  }
  for (const value of [null, [], {}, { ...row, columns_ok: "true", check_ok: 1 }]) {
    expect(projectRunProvenanceCatalog(value).columns_ok).toBeNull();
    expect(projectRunProvenanceCatalog(value).check_ok).toBeNull();
  }
});
test("diagnostic rejects missing opt-in and selectors before IO or timers", async () => {
  const entry = new URL("./run-provenance-diagnostic.integration.ts", import.meta.url);
  for (const args of [[], ["--sql=select 1"]]) {
    const child = Bun.spawn([process.execPath, "--no-env-file", entry.pathname, ...args], { env: {}, stdout: "pipe", stderr: "pipe", timeout: 5000 });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, out, err }).toEqual({ code: 1, out: "", err: "Run provenance diagnostic unavailable.\n" });
  }
});
test("diagnostic imports remain inert and expose only their fixed entry", async () => {
  const script = `import net from 'node:net'; import tls from 'node:tls';
    const deny=()=>{throw Error('Unexpected startup')};
    net.Socket.prototype.connect=deny;tls.connect=deny;globalThis.fetch=deny;Bun.connect=deny;Bun.serve=deny;
    globalThis.setTimeout=deny;globalThis.setInterval=deny;
    const m=await import(${JSON.stringify(new URL("./run-provenance-diagnostic.integration.ts", import.meta.url).href)});
    if(Object.keys(m).join(',')!=='runRunProvenanceDiagnostic')throw Error('Unexpected exports');
    console.log('PASS inert diagnostic');`;
  const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], { env: {}, stdout: "pipe", stderr: "pipe", timeout: 5000 });
  const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
  expect({ code, out, err }).toEqual({ code: 0, out: "PASS inert diagnostic\n", err: "" });
});
test("offline setup protocol preserves failure stage, closes once and keeps normal errors opaque", async () => {
  const root = new URL("../../../../../packages/db/src/", import.meta.url);
  for (const mode of ["apply", "verify", "close", "normal"]) {
    const script = `import {mock} from 'bun:test'; import {strict as assert} from 'node:assert';
      const mode=${JSON.stringify(mode)}; let migrations=0,closed=0,inspections=0;
      mock.module('drizzle-orm/node-postgres/migrator',()=>({migrate:async()=>{
        migrations++;if(mode==='apply'&&migrations===2)throw Error('synthetic-private');}}));
      const client={query:async()=>{inspections++; assert.equal(closed,0); return {rows:[{
        columns_ok:true,check_ok:true,check_expression:'(producer_kindISNULL)',function_ok:true,trigger_ok:true,secret:'synthetic-private'}]};}};
      mock.module(${JSON.stringify(new URL('connection-proof-client.ts',root).pathname)},()=>({openConnectionProof:async()=>({
        owner:client,first:client,second:client,firstDb:{},secondDb:{},healthy(){},close:async()=>{closed++;if(mode==='close')throw Error('synthetic-private');}})}));
      const m=await import(${JSON.stringify(new URL('run-proof-client.ts',root).href)});
      if(mode==='normal'){
        try{await m.openRunProof('synthetic');assert.fail('Expected failure');}catch(e){
          assert.equal(e.message,'Run database proof unavailable.');assert.equal('catalog' in e,false);assert.equal('stage' in e,false);}
      }else{
        const r=await m.diagnoseRunProofSetup('synthetic');
        assert.deepEqual(Object.keys(r).sort(),['catalog','clientsClosed','inspectionFailed','provenanceStage','setupPassed','stage','version','zeroForbiddenIO'].sort());
        assert.equal(r.version,1);assert.equal(r.setupPassed,false);assert.equal(r.inspectionFailed,false);
        assert.equal(r.stage,mode==='apply'?'provenance-apply':'provenance-verification');
        assert.equal(r.provenanceStage,mode==='apply'?'apply':'catalog-verification');
        assert.equal(r.catalog.check_expression,'(producer_kindISNULL)');
        assert.equal(r.clientsClosed,mode!=='close');assert.equal(r.zeroForbiddenIO,mode!=='close');
        assert.equal(JSON.stringify(r).includes('synthetic-private'),false);assert.equal(Object.isFrozen(r),true);
      }
      assert.equal(closed,1);assert.equal(inspections,1);assert.equal(migrations,2);
      console.log('PASS offline protocol');`;
    const child = Bun.spawn([process.execPath, "--no-env-file", "--eval", script], {
      cwd: new URL("../../../../../packages/db/", import.meta.url).pathname, env: {}, stdout: "pipe", stderr: "pipe", timeout: 5000 });
    const [code, out, err] = await Promise.all([child.exited, new Response(child.stdout).text(), new Response(child.stderr).text()]);
    expect({ code, out, err }).toEqual({ code: 0, out: "PASS offline protocol\n", err: "" });
  }
});
