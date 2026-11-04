import { afterAll, describe, expect, test } from "bun:test";
import { mkdtemp, readFile, writeFile } from "node:fs/promises";
import { createServer, type Server, type Socket } from "node:net";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { createMachineRunner, type Target } from "./machine-runner";
import type { ComputerError } from "./service";

/**
 * The FTP kind against real `curl` and a tiny FTP server in this process. The server answers PASV with an address nobody can reach
 * (10.255.255.1): the call only works if curl ignores it and uses the address of the control connection, as `--ftp-skip-pasv-ip` asks.
 * It also refuses TLS (AUTH), so this checks that plain FTP still works when the server has no TLS.
 */
const PASSWORD = "fake-ftp-password";
const stored = new Map<string, string>([["hello.txt", "hello from the ftp server\n"]]);

function ftpServer() {
  const dataServers = new Set<Server>();
  const server = createServer((c: Socket) => {
    let pending: Server | undefined;
    let data: Socket | undefined;
    let loggedIn = false;
    let user = "";
    const say = (line: string) => c.write(`${line}\r\n`);
    const withData = (fn: (d: Socket) => void) => {
      if (data) fn(data);
      else pending?.once("connection", fn);
    };
    c.on("error", () => undefined);
    say("220 test ftp");
    let buf = "";
    c.on("data", (chunk) => {
      buf += chunk.toString();
      for (let i = buf.indexOf("\r\n"); i >= 0; i = buf.indexOf("\r\n")) {
        const line = buf.slice(0, i);
        buf = buf.slice(i + 2);
        const [cmd = "", ...rest] = line.split(" ");
        const arg = rest.join(" ");
        switch (cmd.toUpperCase()) {
          case "AUTH":
            say("502 no tls");
            break;
          case "USER":
            user = arg;
            say("331 password");
            break;
          case "PASS":
            loggedIn = user === "bob" && arg === PASSWORD;
            say(loggedIn ? "230 in" : "530 denied");
            break;
          case "PWD":
            say('257 "/" is the directory');
            break;
          case "TYPE":
          case "CWD":
            say(loggedIn ? "200 ok" : "530 login first");
            break;
          case "EPSV":
            say("500 use PASV");
            break;
          case "PASV": {
            pending = createServer((d) => {
              data = d;
            });
            dataServers.add(pending);
            pending.listen(0, "127.0.0.1", () => {
              const port = (pending!.address() as { port: number }).port;
              say(`227 Entering Passive Mode (10,255,255,1,${port >> 8},${port & 255})`);
            });
            break;
          }
          case "SIZE":
            say(stored.has(arg) ? `213 ${stored.get(arg)!.length}` : "550 none");
            break;
          case "LIST":
            say("150 listing");
            withData((d) => {
              d.end(
                [...stored.keys()]
                  .map((k) => `-rw-r--r-- 1 ftp ftp ${stored.get(k)!.length} Nov 04 00:00 ${k}\r\n`)
                  .join(""),
              );
              say("226 done");
            });
            break;
          case "RETR":
            if (!stored.has(arg)) say("550 none");
            else {
              say("150 sending");
              withData((d) => {
                d.end(stored.get(arg) ?? "");
                say("226 done");
              });
            }
            break;
          case "STOR":
            say("150 receiving");
            withData((d) => {
              let body = "";
              d.on("data", (x) => (body += x.toString()));
              d.on("end", () => {
                stored.set(arg, body);
                say("226 stored");
              });
            });
            break;
          case "QUIT":
            say("221 bye");
            c.end();
            break;
          default:
            say("502 no");
        }
      }
    });
  });
  return { server, dataServers };
}

const { server, dataServers } = ftpServer();
await new Promise<void>((r) => server.listen(0, "127.0.0.1", () => r()));
const port = (server.address() as { port: number }).port;
afterAll(() => {
  server.close();
  for (const d of dataServers) d.close();
});

// The name does not resolve anywhere: only the pinned address in `ip` can get the call to the server.
const target: Target = {
  kind: "ftp",
  host: "files.example.invalid",
  ip: "127.0.0.1",
  port,
  username: "bob",
  hostKey: null,
};
const runner = createMachineRunner();
const codeOf = async (p: Promise<unknown>) =>
  p.then(
    () => "none",
    (e: ComputerError) => e.code,
  );

describe("ftp against a real curl", () => {
  test("lists a directory", async () => {
    const r = await runner.exec(target, PASSWORD, { type: "list", path: "/" });
    expect(r.exitCode).toBe(0);
    expect(r.output).toBe("-rw-r--r-- 1 ftp ftp 26 Nov 04 00:00 hello.txt");
  });

  test("downloads a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zftp-"));
    const local = join(dir, "got.txt");
    const r = await runner.exec(target, PASSWORD, { type: "get", remote: "hello.txt", local });
    expect(r.output).toBe("Downloaded.");
    expect(await readFile(local, "utf8")).toBe("hello from the ftp server\n");
  });

  test("uploads a file", async () => {
    const dir = await mkdtemp(join(tmpdir(), "zftp-"));
    const local = join(dir, "up.txt");
    await writeFile(local, "sent by a bot\n");
    const r = await runner.exec(target, PASSWORD, { type: "put", local, remote: "up.txt" });
    expect(r.output).toBe("Uploaded.");
    expect(stored.get("up.txt")).toBe("sent by a bot\n");
  });

  test("a wrong password is AUTH_FAILED", async () => {
    expect(await codeOf(runner.exec(target, "not-the-password", { type: "list", path: "/" }))).toBe(
      "AUTH_FAILED",
    );
  });

  test("a closed port is UNREACHABLE", async () => {
    expect(
      await codeOf(runner.exec({ ...target, port: 1 }, PASSWORD, { type: "list", path: "/" })),
    ).toBe("UNREACHABLE");
  });
});
