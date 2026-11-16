import { beforeEach, describe, expect, test } from "bun:test";
import { Elysia } from "elysia";
import { createIdentityAccess } from "../identity/access";
import { createConnectionRoutes } from "./routes";
import { PROVIDERS } from "./service";

const origin = "https://app.example.invalid";
const SECRET = "sk-test-0123456789abcdef";

const created: { provider: string; label: string; secret: string; by: string }[] = [];
const recorded: (string | null)[] = [];
const opened: { userId: string; purpose: string }[] = [];
let openError: Error | undefined;

const access = createIdentityAccess(
  {
    api: {
      getSession: async ({ headers }: { headers: Headers }) => {
        const id = headers.get("cookie");
        return id
          ? { user: { id, name: id, email: `${id}@example.invalid` }, session: { id: "s" } }
          : null;
      },
    },
  } as never,
  async (id) => ({ isAdmin: id === "admin" }),
);
const connections = {
  configured: () => true,
  providers: PROVIDERS,
  list: async () => [],
  create: async (a: { userId: string }, v: { provider: string; label: string; secret: string }) => {
    created.push({ ...v, by: a.userId });
    return {
      id: "c0000000-0000-7000-8000-000000000001",
      provider: v.provider,
      label: v.label,
      state: "active",
      revision: 1,
    };
  },
} as never;
// The keyring opens what the browser sealed; here "sealed" is the plain payload, and the purpose it was sealed for is recorded.
const keyring = {
  publicKey: async () => ({}),
  open: async (sealed: unknown, ctx: { userId: string; purpose: string }) => {
    opened.push(ctx);
    if (openError) throw openError;
    return sealed;
  },
} as never;
const app = () =>
  new Elysia().use(
    createConnectionRoutes(
      { access, connections, transcribeKey: { set: async (id) => void recorded.push(id) } },
      [origin],
      keyring,
    ),
  );
const call = (as: string, method: string, path: string, body?: unknown) =>
  app().handle(
    new Request(`http://localhost${path}`, {
      method,
      headers: { origin, cookie: as, "content-type": "application/json" },
      body: body ? JSON.stringify(body) : undefined,
    }),
  );
beforeEach(() => {
  created.length = 0;
  recorded.length = 0;
  opened.length = 0;
  openError = undefined;
});

describe("the speech-to-text key of the installation", () => {
  test("an administrator saves a sealed key: it becomes their connection, the installation points to it, nothing secret comes back", async () => {
    const r = await call("admin", "PUT", "/api/connections/transcribe-key", {
      sealed: { secret: SECRET },
    });
    expect(r.status).toBe(200);
    const text = await r.text();
    expect(text).not.toContain(SECRET);
    expect(JSON.parse(text)).toEqual({ ok: true });
    expect(opened).toEqual([{ userId: "admin", purpose: "installation.transcribe-key" }]);
    expect(created).toEqual([
      { provider: "transcribe", label: "Speech to text", secret: SECRET, by: "admin" },
    ]);
    expect(recorded).toEqual(["c0000000-0000-7000-8000-000000000001"]);
  });

  test("a member cannot save or remove it, and nothing is opened or stored", async () => {
    expect(
      (
        await call("member", "PUT", "/api/connections/transcribe-key", {
          sealed: { secret: SECRET },
        })
      ).status,
    ).toBe(403);
    expect((await call("member", "DELETE", "/api/connections/transcribe-key")).status).toBe(403);
    expect(opened).toEqual([]);
    expect(created).toEqual([]);
    expect(recorded).toEqual([]);
  });

  test("a key that is too short, an unknown field, or a payload that cannot be opened is refused", async () => {
    expect(
      (
        await call("admin", "PUT", "/api/connections/transcribe-key", {
          sealed: { secret: "short" },
        })
      ).status,
    ).toBe(400);
    expect(
      (
        await call("admin", "PUT", "/api/connections/transcribe-key", {
          sealed: { secret: SECRET },
          extra: 1,
        })
      ).status,
    ).toBe(400);
    expect(
      (await call("admin", "PUT", "/api/connections/transcribe-key", { secret: SECRET })).status,
    ).toBe(400);
    openError = new Error("bad seal");
    expect(
      (
        await call("admin", "PUT", "/api/connections/transcribe-key", {
          sealed: { secret: SECRET },
        })
      ).status,
    ).not.toBe(200);
    expect(created).toEqual([]);
    expect(recorded).toEqual([]);
  });

  test("an administrator removes it: the installation points to nothing", async () => {
    expect((await call("admin", "DELETE", "/api/connections/transcribe-key")).status).toBe(200);
    expect(recorded).toEqual([null]);
  });

  test("it is not an ordinary account: not listed, and not created through the generic route", async () => {
    const list = (await (await call("admin", "GET", "/api/connections")).json()) as {
      providers: string[];
    };
    expect(list.providers).not.toContain("transcribe");
    const generic = await call("admin", "POST", "/api/connections", {
      provider: "transcribe",
      label: "x",
      sealed: { secret: SECRET },
    });
    expect(generic.status).toBe(400);
    expect(created).toEqual([]);
  });
});
