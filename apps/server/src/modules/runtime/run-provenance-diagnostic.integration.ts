import { requireIdentityAuthProofTarget } from "../identity/signup.integration";

export async function runRunProvenanceDiagnostic() {
  try {
    if (process.argv.length !== 2) throw new Error("Unexpected selector.");
    const target = requireIdentityAuthProofTarget(process.env);
    const deadline = setTimeout(() => {
      process.stderr.write("Run provenance diagnostic deadline exceeded; cleanup unknown.\n"); process.exit(1);
    }, 120_000);
    try {
      const { diagnoseRunProofSetup } = await import("../../../../../packages/db/src/run-proof-client");
      const report = await diagnoseRunProofSetup(target.connectionString);
      process.stdout.write(`DIAGNOSTIC ${JSON.stringify(report)}\n`);
      if (report.clientsClosed && report.zeroForbiddenIO) process.stdout.write("PASS reserved diagnostic clients closed; zero forbidden IO\n");
      if (!report.setupPassed || !report.clientsClosed || !report.zeroForbiddenIO) process.exitCode = 1;
    } finally { clearTimeout(deadline); }
  } catch { // no-excuse-ok: catch -- fixed message only; no driver error or target escapes.
    process.stderr.write("Run provenance diagnostic unavailable.\n"); process.exitCode = 1;
  }
}
if (import.meta.main) await runRunProvenanceDiagnostic();
