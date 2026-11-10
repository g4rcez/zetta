import { Elysia } from "elysia";
import { z } from "zod";
import {
  computerDrivers,
  computerOsList,
  computerTargets,
  machineKinds,
} from "@zetta/db/schema/features";
import { TransportError } from "@zetta/core/sealed-transport";
import { ConnectionsUnavailableError } from "../connections/service";
import { ConnectionStoreError } from "../connections/store-contract";
import {
  TransportKeyExpiredError,
  transportKeyring,
  type TransportKeyring,
} from "../connections/transport";
import { AccessError, type ActiveActor, type createIdentityAccess } from "../identity/access";
import { MAX_SECRET, type MachineService } from "./machines";
import { ComputerError, type ComputerService } from "./service";
import type { VmService } from "./vm";
import { openVncBridge, type VncBridge } from "./vnc";
import { accessFail, fail, out, rejectUntrustedOrigin } from "../http-response";

export type ComputerServices = {
  access: ReturnType<typeof createIdentityAccess>;
  computer: ComputerService;
  vms?: VmService;
  machines?: MachineService;
};
const profile = z.string().regex(/^[A-Za-z0-9_-]{1,64}$/);
const action = z.discriminatedUnion("type", [
  z.strictObject({ type: z.literal("open"), url: z.string().url().max(2000) }),
  z.strictObject({
    type: z.literal("click"),
    x: z.number().min(0).max(4000),
    y: z.number().min(0).max(4000),
  }),
  z.strictObject({ type: z.literal("type"), text: z.string().max(2000) }),
  z.strictObject({ type: z.literal("key"), key: z.string().min(1).max(30) }),
  z.strictObject({ type: z.literal("scroll"), dy: z.number() }),
]);
const vmAction = z.discriminatedUnion("type", [
  z.strictObject({
    type: z.literal("click"),
    x: z.number().min(0).max(8000),
    y: z.number().min(0).max(8000),
  }),
  z.strictObject({ type: z.literal("type"), text: z.string().max(2000) }),
  z.strictObject({ type: z.literal("key"), key: z.string().min(1).max(40) }),
  z.strictObject({
    type: z.literal("scroll"),
    direction: z.enum(["up", "down", "left", "right"]),
    amount: z.number().int().min(1).max(20).optional(),
  }),
  z.strictObject({ type: z.literal("launch"), app: z.string().min(1).max(60) }),
  z.strictObject({ type: z.literal("navigate"), url: z.string().url().max(2000) }),
]);
const vmId = z.string().uuid();
const vmCreate = z.strictObject({
  name: z.string().min(1).max(60),
  target: z.enum(computerTargets.filter((t) => t !== "cua") as ["vm", "local"]).optional(),
  driver: z.enum(computerDrivers).optional(),
  os: z.enum(computerOsList).optional(),
});
const machineSecret = z.strictObject({ secret: z.string().min(1).max(MAX_SECRET) });
const machineCreate = z.strictObject({
  name: z.string().min(1).max(60),
  kind: z.enum(machineKinds),
  host: z.string().min(1).max(253),
  port: z.number().int().min(1).max(65535).optional(),
  username: z.string().min(1).max(64),
  hostKey: z.string().max(1000).optional(),
  /** The bots that may use the machine. */
  botIds: z.array(z.string().uuid()).max(50).default([]),
  sealed: z.unknown(),
});
const defaultPort = (kind: (typeof machineKinds)[number]) => (kind === "ftp" ? 21 : 22);
/** What the person sees for a machine failure. It never carries the output or the secret. */
const MACHINE_MESSAGES: Partial<Record<ComputerError["code"], string>> = {
  HOST_KEY_CHANGED:
    "The machine's host key is not the one you confirmed. Check it before you trust it again.",
  AUTH_FAILED: "The machine refused the key or password.",
  UNREACHABLE: "Zetta could not reach that machine.",
  SLOW: "The machine took too long to answer.",
  INVALID:
    "Check the details and try again. A private key needs to be unencrypted (no passphrase).",
  INSECURE: "Use an https address.",
};
/** A computer on another machine that runs cua-spacesd. The bearer token arrives sealed, so a plaintext `token` fails the strict schema. */
const vmRemoteCreate = z.strictObject({
  name: z.string().min(1).max(60),
  target: z.literal("cua"),
  endpoint: z.string().url().max(300),
  sealed: z.unknown(),
});

export function createComputerRoutes(
  { access, computer, vms, machines }: ComputerServices,
  trustedOrigins: readonly string[],
  keyring: TransportKeyring = transportKeyring,
) {
  type Ctx = { userId: string; actor: ActiveActor; body: unknown; params: Record<string, string> };
  const g =
    (work: (c: Ctx) => Promise<unknown>, status = 200) =>
    async ({
      request,
      body,
      params,
    }: {
      request: Request;
      body: unknown;
      params: Record<string, string>;
    }) => {
      try {
        const denied = rejectUntrustedOrigin(request, trustedOrigins);
        if (denied) return denied;
        const actor = await access.requireActive(request.headers);
        return out(await work({ userId: actor.userId, actor, body, params }), status);
      } catch (e) {
        if (e instanceof AccessError) return accessFail(e);
        if (e instanceof ComputerError)
          return fail(
            e.code === "NOT_FOUND"
              ? 404
              : e.code === "REVOKED"
                ? 410
                : e.code === "LIMIT" ||
                    e.code === "HUMAN_IN_CONTROL" ||
                    e.code === "STALE_CONTROL" ||
                    e.code === "HOST_KEY_CHANGED"
                  ? 409
                  : e.code === "UNAVAILABLE"
                    ? 503
                    : e.code === "UNREACHABLE"
                      ? 502
                      : 400,
            e.code,
            e.code === "BLOCKED_URL"
              ? "That address is not allowed."
              : e.code === "LIMIT"
                ? "Close another browser session or stop a desktop first."
                : e.code === "HUMAN_IN_CONTROL"
                  ? "A person has taken over this session."
                  : e.code === "UNAVAILABLE"
                    ? "The browser is not available right now."
                    : (MACHINE_MESSAGES[e.code] ?? "Check the details and try again."),
          );
        if (e instanceof TransportKeyExpiredError)
          return fail(409, "TRANSPORT_KEY_EXPIRED", "The encryption key rotated. Try again.");
        if (e instanceof ConnectionsUnavailableError || e instanceof ConnectionStoreError)
          return fail(503, "CONNECTIONS_UNAVAILABLE", "Secrets storage is unavailable right now.");
        if (e instanceof z.ZodError || e instanceof TransportError)
          return fail(400, "INVALID_REQUEST", "Check the details and try again.");
        return fail(500, "UNAVAILABLE", "Something went wrong. Please retry.");
      }
    };
  const p = (c: Ctx) => profile.parse(c.params.profile);
  const needVms = () => {
    if (!vms) throw new ComputerError("UNAVAILABLE");
    return vms;
  };
  const v = (c: Ctx) => vmId.parse(c.params.id);
  const needMachines = () => {
    if (!machines) throw new ComputerError("UNAVAILABLE");
    return machines;
  };
  /** Live VNC viewers, by socket: the bridge to the VM opens asynchronously, and bytes the browser sends meanwhile wait in `early`. */
  const viewers = new Map<
    object,
    { bridge?: VncBridge; early: Uint8Array[]; release?: () => void; closed?: boolean }
  >();
  return (
    new Elysia({ prefix: "/api/computer", normalize: false })
      .get(
        "/sessions",
        g(async (c) => ({ sessions: computer.list(c.userId) })),
      )
      .post(
        "/sessions",
        g(
          async (c) => ({
            session: await computer.start(
              c.userId,
              profile.parse((c.body as { profile?: string } | null)?.profile ?? "default"),
            ),
          }),
          201,
        ),
      )
      .post(
        "/sessions/:profile/action",
        g(async (c) => ({
          session: await computer.act(c.userId, p(c), "user", action.parse(c.body)),
        })),
      )
      .get(
        "/sessions/:profile/screenshot",
        g(async (c) => ({ png: await computer.screenshot(c.userId, p(c)) })),
      )
      .get(
        "/sessions/:profile/text",
        g(async (c) => ({ text: await computer.text(c.userId, p(c)) })),
      )
      .post(
        "/sessions/:profile/takeover",
        g(async (c) => {
          const v = z
            .strictObject({ human: z.boolean(), expected: z.enum(["agent", "human"]).optional() })
            .parse(c.body);
          return { session: computer.takeover(c.userId, p(c), v.human, v.expected) };
        }),
      )
      .get(
        "/capabilities",
        g(async () => ({
          ...computer.capabilities(),
          desktop: Boolean(vms),
          desktopBackend: vms ? "vm" : null,
          targets: vms?.options().targets ?? { vm: [], local: [] },
          os: vms?.options().os ?? [],
          note: vms
            ? "Each user has a persistent Linux desktop (Debian + Chromium); bots can ask for more. Browser sessions are separate."
            : computer.capabilities().note,
        })),
      )
      .get(
        "/vms",
        g(async (c) => ({ vms: await needVms().list(c.userId) })),
      )
      .post(
        "/vms",
        g(async (c) => {
          const b = z.union([vmCreate, vmRemoteCreate]).parse(c.body);
          if (b.target !== "cua") return { vm: await needVms().create(c.userId, b) };
          const { secret } = machineSecret.parse(
            await keyring.open(b.sealed, { userId: c.userId, purpose: "computer.create:cua" }),
          );
          return {
            vm: await needVms().createRemote(c.userId, {
              name: b.name,
              endpoint: b.endpoint,
              token: secret,
            }),
          };
        }, 201),
      )
      .patch(
        "/vms/:id",
        g(async (c) => {
          const b = z.strictObject({ driver: z.enum(computerDrivers) }).parse(c.body);
          await needVms().setDriver(c.userId, v(c), b.driver);
          return { ok: true };
        }),
      )
      .post(
        "/vms/default/start",
        g(async (c) => ({ vm: await needVms().start(c.userId) })),
      )
      .post(
        "/vms/:id/start",
        g(async (c) => ({ vm: await needVms().start(c.userId, v(c)) })),
      )
      .post(
        "/vms/:id/stop",
        g(async (c) => {
          await needVms().stop(c.userId, v(c));
          return { ok: true };
        }),
      )
      .delete(
        "/vms/:id",
        g(async (c) => {
          await needVms().remove(c.userId, v(c));
          return { ok: true };
        }),
      )
      .post(
        "/vms/:id/action",
        g(async (c) => ({
          vm: await needVms().act(c.userId, v(c), "user", vmAction.parse(c.body)),
        })),
      )
      .post(
        "/vms/:id/paste",
        g(async (c) => {
          await needVms().paste(
            c.userId,
            v(c),
            z.strictObject({ text: z.string().min(1).max(4000) }).parse(c.body).text,
          );
          return { ok: true };
        }),
      )
      .post(
        "/vms/:id/keyboard",
        g(async (c) => ({
          keyboard: await needVms().keyboard(
            c.userId,
            v(c),
            z.strictObject({ layout: z.string().max(20) }).parse(c.body).layout,
          ),
        })),
      )
      .post(
        "/vms/:id/vnc-ticket",
        g(async (c) => ({ ticket: needVms().vncTicket(c.userId, v(c)) })),
      )
      // The browser's VNC client (noVNC). Browsers send no custom headers on a WebSocket: the one-time ticket from vnc-ticket (an
      // authenticated, origin-checked POST) is the credential, and the Origin is checked again here against cross-site sockets.
      .ws("/vms/:id/vnc", {
        async open(ws) {
          const state: {
            bridge?: VncBridge;
            early: Uint8Array[];
            release?: () => void;
            closed?: boolean;
          } = { early: [] };
          viewers.set(ws.raw, state);
          try {
            const origin = ws.data.headers.origin;
            if (!origin || !trustedOrigins.includes(origin)) throw new ComputerError("NOT_FOUND");
            const viewer = needVms().vncViewer(
              String((ws.data.query as Record<string, unknown>).ticket ?? ""),
              vmId.parse(ws.data.params.id),
            );
            state.release = viewer.release;
            const bridge = await openVncBridge({
              port: viewer.port,
              password: viewer.password,
              viewer: {
                send: (b) => {
                  ws.raw.send(b);
                },
                close: (code, reason) => ws.raw.close(code, reason),
              },
            });
            if (state.closed) {
              bridge.close();
              return;
            }
            state.bridge = bridge;
            for (const b of state.early.splice(0)) bridge.fromViewer(b);
          } catch {
            state.release?.();
            ws.raw.close(4404, "This computer is not running.");
          }
        },
        message(ws, message) {
          const state = viewers.get(ws.raw);
          if (!state || !(message instanceof Uint8Array)) return;
          if (state.bridge) state.bridge.fromViewer(message);
          else state.early.push(message);
        },
        close(ws) {
          const state = viewers.get(ws.raw);
          viewers.delete(ws.raw);
          if (!state) return;
          state.closed = true;
          state.bridge?.close();
          state.release?.();
        },
      })
      .get(
        "/vms/:id/screenshot",
        g(async (c) => ({ png: await needVms().screenshot(c.userId, v(c)) })),
      )
      .get(
        "/vms/:id/text",
        g(async (c) => ({ text: await needVms().read(c.userId, v(c)) })),
      )
      .post(
        "/vms/:id/takeover",
        g(async (c) => {
          const b = z
            .strictObject({ human: z.boolean(), expected: z.enum(["agent", "human"]).optional() })
            .parse(c.body);
          return { vm: needVms().takeover(c.userId, v(c), b.human, b.expected) };
        }),
      )
      .get(
        "/profiles",
        g(async (c) => ({ profiles: await computer.profiles(c.userId) })),
      )
      .put(
        "/profiles/:profile/own-browser",
        g(async (c) => {
          const b = z
            .strictObject({ port: z.number().int().min(1024).max(65535).nullable() })
            .parse(c.body);
          return { profile: await computer.setOwnBrowser(c.userId, p(c), b.port) };
        }),
      )
      .post(
        "/profiles/:profile/reset",
        g(async (c) => {
          await computer.reset(c.userId, p(c));
          return { ok: true };
        }),
      )
      .delete(
        "/profiles/:profile",
        g(async (c) => {
          await computer.revokeProfile(c.userId, p(c));
          return { ok: true };
        }),
      )
      // Machines (ssh, sftp, ftp). The key or password arrives sealed to the server key, like every other secret; a plaintext field fails the strict schemas.
      .get(
        "/machines",
        g(async (c) => ({ machines: await needMachines().list(c.userId) })),
      )
      .post(
        "/machines/scan",
        g(async (c) => {
          const b = z
            .strictObject({
              host: z.string().min(1).max(253),
              port: z.number().int().min(1).max(65535),
            })
            .parse(c.body);
          return { keys: await needMachines().scan(b.host, b.port) };
        }),
      )
      .post(
        "/machines",
        g(async (c) => {
          const b = machineCreate.parse(c.body);
          const { secret } = machineSecret.parse(
            await keyring.open(b.sealed, { userId: c.userId, purpose: `machine.create:${b.kind}` }),
          );
          const { sealed: _sealed, ...rest } = b;
          return {
            machine: await needMachines().create(c.actor, {
              ...rest,
              port: b.port ?? defaultPort(b.kind),
              secret,
            }),
          };
        }, 201),
      )
      .put(
        "/machines/:id/secret",
        g(async (c) => {
          const { sealed } = z.strictObject({ sealed: z.unknown() }).parse(c.body);
          const { secret } = machineSecret.parse(
            await keyring.open(sealed, { userId: c.userId, purpose: `machine.secret:${v(c)}` }),
          );
          return { machine: await needMachines().setSecret(c.actor, v(c), secret) };
        }),
      )
      .put(
        "/machines/:id/bots",
        g(async (c) => {
          const b = z.strictObject({ botIds: z.array(z.string().uuid()).max(50) }).parse(c.body);
          return { machine: await needMachines().setBots(c.actor, v(c), b.botIds) };
        }),
      )
      .get(
        "/machines/:id/public-key",
        g(async (c) => ({ publicKey: await needMachines().publicKey(c.actor, v(c)) })),
      )
      .delete(
        "/machines/:id",
        g(async (c) => {
          await needMachines().remove(c.actor, v(c));
          return { ok: true };
        }),
      )
      .delete(
        "/sessions/:profile",
        g(async (c) => {
          await computer.close(c.userId, p(c));
          return { ok: true };
        }),
      )
  );
}
