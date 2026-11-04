import { describe, expect, test } from "bun:test";
import { planSetup } from "./setup";

const secret = () => "SECRET";

describe("planSetup lan", () => {
  const plan = planSetup({ mode: "lan", address: "192.168.1.10", server: "", web: "", secret });

  test("points every URL at the LAN address over https", () => {
    expect(plan.server).toContain("BETTER_AUTH_URL=https://192.168.1.10:3000\n");
    expect(plan.server).toContain("CORS_ORIGIN=https://192.168.1.10:3001\n");
    expect(plan.web).toContain("VITE_SERVER_URL=https://192.168.1.10:3000\n");
    expect(plan.url).toBe("https://192.168.1.10:3001");
  });
  test("opens the listeners and sets the certificate", () => {
    expect(plan.server).toContain("ZETTA_HOST=0.0.0.0\n");
    expect(plan.server).toContain("ZETTA_TLS_CERT=../../.certs/localhost.pem\n");
    expect(plan.server).toContain("NODE_EXTRA_CA_CERTS=../../.certs/rootCA.pem\n");
    expect(plan.web).toContain("ZETTA_HOST=0.0.0.0\n");
    expect(plan.web).toContain("ZETTA_TLS_KEY=../../.certs/localhost-key.pem\n");
  });
  test("creates the secrets and returns the setup key", () => {
    expect(plan.server).toContain("ZETTA_SETUP_KEY=SECRET\n");
    expect(plan.setupKey).toBe("SECRET");
  });
  test("needs an address", () => {
    expect(() => planSetup({ mode: "lan", server: "", web: "" })).toThrow("LAN address");
  });
});

describe("planSetup local", () => {
  test("uses http localhost, clears the network and TLS settings and keeps filled secrets", () => {
    const plan = planSetup({
      mode: "local",
      server:
        "BETTER_AUTH_SECRET=keep\nZETTA_CONNECTION_KEY=keep\nZETTA_SETUP_KEY=keep\nDATABASE_URL=keep\nZETTA_HOST=0.0.0.0\nZETTA_TLS_CERT=../../.certs/localhost.pem\n",
      web: "ZETTA_HOST=0.0.0.0\n",
      secret,
    });
    expect(plan.server).toBe(
      [
        "BETTER_AUTH_SECRET=keep",
        "ZETTA_CONNECTION_KEY=keep",
        "ZETTA_SETUP_KEY=keep",
        "DATABASE_URL=keep",
        "ZETTA_HOST=",
        "ZETTA_TLS_CERT=",
        "BETTER_AUTH_URL=http://localhost:3000",
        "CORS_ORIGIN=http://localhost:3001",
        "ZETTA_TLS_KEY=",
        "NODE_EXTRA_CA_CERTS=",
        "",
      ].join("\n"),
    );
    expect(plan.web).toContain("VITE_SERVER_URL=http://localhost:3000\n");
    expect(plan.web).toContain("ZETTA_HOST=\n");
    expect(plan.setupKey).toBeUndefined();
  });
});
