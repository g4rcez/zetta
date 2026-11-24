import { connect } from "node:net";
import { uuidv7 } from "@zetta/core/uuid";
import nodemailer from "nodemailer";
import { engine, freePort, waitUntil } from "../integrations/plugins/vault/vault-real-setup";

/**
 * Helpers for the mail tests that run against a REAL mail server: GreenMail (a Java IMAP and SMTP server made for tests) in a local
 * container. Nothing here reaches a hosted service; the addresses are `@example.invalid` and the passwords are made up.
 *
 * Opt-in, never part of the default run (see `imap.integration.test.ts`): `ZETTA_TEST_GREENMAIL=1` and `ZETTA_DOCKER_BIN=<engine binary>`.
 */
export const GREENMAIL_ENABLED = process.env.ZETTA_TEST_GREENMAIL === "1";
export const GREENMAIL_IMAGE =
  process.env.ZETTA_GREENMAIL_IMAGE || "docker.io/greenmail/standalone:latest";
export const DOMAIN = "example.invalid";

export type TestUser = { login: string; password: string };
export const addressOf = (u: TestUser) => `${u.login}@${DOMAIN}`;
/** What to sign in with: the whole address. */
export const loginOf = addressOf;

export type Greenmail = {
  name: string;
  imapPort: number;
  smtpPort: number;
  /** Restarts the server: it comes back empty, with the same users and a new UIDVALIDITY (a mailbox that was rebuilt). */
  restart(): Promise<void>;
  stop(): Promise<void>;
};

/** Whether something on the port speaks like a mail server (it sends a greeting line). */
const greets = (port: number) =>
  new Promise<boolean>((resolve) => {
    const s = connect({ host: "127.0.0.1", port });
    const done = (ok: boolean) => {
      s.destroy();
      resolve(ok);
    };
    const timer = setTimeout(() => done(false), 1500);
    const done2 = (ok: boolean) => {
      clearTimeout(timer);
      done(ok);
    };
    s.once("data", (d) => done2(/^\* OK|^220 /.test(String(d))));
    s.once("error", () => done2(false));
    // The engine's port forwarder accepts before the server is up, then drops the connection.
    s.once("close", () => done2(false));
  });

/**
 * Starts one container (named `zetta-greenmail-<random tail>`) with authentication ON, so a wrong password really is refused.
 * Plain ports only (SMTP 3025, IMAP 3143), published on 127.0.0.1 at random free host ports.
 */
export async function startGreenmail(users: TestUser[]): Promise<Greenmail> {
  const name = `zetta-greenmail-${uuidv7().slice(-8)}`;
  const imapPort = freePort(),
    smtpPort = freePort();
  const opts = [
    "-Dgreenmail.setup.test.smtp",
    "-Dgreenmail.setup.test.imap",
    "-Dgreenmail.hostname=0.0.0.0",
    // The user name is the whole address, as at most providers (the default would be the part before the @).
    "-Dgreenmail.users.login=email",
    `-Dgreenmail.users=${users.map((u) => `${u.login}:${u.password}@${DOMAIN}`).join(",")}`,
  ].join(" ");
  await engine([
    "run",
    "-d",
    "--name",
    name,
    "-p",
    `127.0.0.1:${imapPort}:3143`,
    "-p",
    `127.0.0.1:${smtpPort}:3025`,
    "-e",
    `GREENMAIL_OPTS=${opts}`,
    GREENMAIL_IMAGE,
  ]);
  const stop = async () => void (await engine(["rm", "-f", name], true));
  const ready = () =>
    waitUntil(
      async () => (await greets(imapPort)) && (await greets(smtpPort)),
      "GreenMail",
      90_000,
    );
  try {
    await ready();
  } catch (e) {
    await stop();
    throw e;
  }
  const restart = async () => {
    await engine(["restart", "-t", "1", name]);
    // The server needs more than a second to be a new mailbox: UIDVALIDITY is the time it started, in seconds.
    await Bun.sleep(1500);
    await ready();
  };
  return { name, imapPort, smtpPort, restart, stop };
}

/** One message delivered the way a person's mail program does it: by SMTP, with every header written out exactly as given. */
export async function deliver(
  g: Greenmail,
  o: {
    from: string;
    to: string;
    headers?: Record<string, string>;
    subject: string;
    body?: string;
    mime?: string;
  },
) {
  const t = nodemailer.createTransport({
    host: "127.0.0.1",
    port: g.smtpPort,
    secure: false,
    ignoreTLS: true,
  });
  const lines = [
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: ${o.subject}`,
    ...Object.entries(o.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    ...(o.mime ? [] : ["Content-Type: text/plain; charset=utf-8"]),
  ];
  const raw = o.mime ?? `${lines.join("\r\n")}\r\n\r\n${o.body ?? "Hello."}\r\n`;
  const bare = (a: string) => /<([^>]+)>/.exec(a)?.[1] ?? a;
  try {
    await t.sendMail({ envelope: { from: bare(o.from), to: [bare(o.to)] }, raw });
  } finally {
    t.close();
  }
}

/** The same message with the standard headers in front of a hand-written MIME body. */
export const withHeaders = (
  o: { from: string; to: string; subject: string; headers?: Record<string, string> },
  mimeHeaders: string,
  body: string,
) =>
  [
    `From: ${o.from}`,
    `To: ${o.to}`,
    `Subject: ${o.subject}`,
    ...Object.entries(o.headers ?? {}).map(([k, v]) => `${k}: ${v}`),
    "MIME-Version: 1.0",
    mimeHeaders,
    "",
    body,
  ].join("\r\n");
