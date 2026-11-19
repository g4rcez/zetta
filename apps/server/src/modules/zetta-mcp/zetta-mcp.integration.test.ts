import { afterAll, beforeAll, describe, expect, test } from "bun:test";
import { Client } from "@modelcontextprotocol/sdk/client/index.js";
import { StreamableHTTPClientTransport } from "@modelcontextprotocol/sdk/client/streamableHttp.js";
import { createAuth, mcpResource } from "@zetta/auth";
import { createDb } from "@zetta/db";
import { installationIdentity, membership } from "@zetta/db/schema/identity";
import { user } from "@zetta/db/schema/auth";
import { oauthClient, oauthClientResource } from "@zetta/db/schema/auth";
import { eq } from "@zetta/db/query";

import { createApp } from "../../app";
import { cleanupTestUsers, resetOrgChart } from "../../test-support/db-cleanup";
import { createChatService } from "../chat/service";
import { audit } from "../features/audit";
import { createMembershipLookup, issueBackgroundActor } from "../identity/access";
import { createOrgStore } from "../org/store";
import { createLessons } from "../learning/lessons";
import { createProgress } from "../learning/progress";
import { createLessonTools } from "../learning/workflow-tool";
import { createMemory } from "../memory/service";
import { createOutputStyles } from "../output-styles/service";
import { createTaskStore } from "../tasks/store";

const url = process.env.ZETTA_CHAT_TEST_DATABASE_URL;
// A skipped describe still runs its body, and this one starts a server that queries the database: without one, register nothing.
const suite: typeof describe = url ? describe : ((() => {}) as never);
const REDIRECT = "http://127.0.0.1:8976/callback";

suite("Zetta MCP server: OAuth 2.1 sign-in and tools against compose postgres", () => {
  const db = createDb({ DATABASE_URL: url ?? "postgresql://unused@localhost/unused" } as never);
  const tasks = createTaskStore(db);
  const lookup = createMembershipLookup(db);
  let app: ReturnType<typeof createApp> | undefined;
  // Loopback HTTP is the only plain-HTTP origin OAuth accepts for the MCP resource.
  const server = Bun.serve({
    port: 0,
    hostname: "127.0.0.1",
    fetch: (request) => app!.handle(request),
  });
  const origin = `http://127.0.0.1:${server.port}`;
  const env = {
    BETTER_AUTH_URL: origin,
    BETTER_AUTH_SECRET: "synthetic-only-not-a-production-secret",
    CORS_ORIGIN: "https://web.example.invalid",
  };
  const auth = createAuth(env, db);
  const resource = mcpResource(env);
  const email = `mcp-${Bun.randomUUIDv7().slice(-12)}@example.invalid`;
  const password = "synthetic-only-password";
  let userId = "";
  // Another member of the installation: the administrator when the signed-in member must not be.
  const otherId = `mcp-other-${Bun.randomUUIDv7().slice(-12)}`;
  let cookie = "";
  let clientId = "";

  const verifier = "v".repeat(64);

  /** The signed-in member opens the client's authorization link; resolves where the API sends the browser next. */
  async function authorize(scope: string, session = cookie) {
    const link = new URL("/api/auth/oauth2/authorize", origin);
    const challenge = new Bun.CryptoHasher("sha256").update(verifier).digest("base64url");
    for (const [k, v] of Object.entries({
      response_type: "code",
      client_id: clientId,
      redirect_uri: REDIRECT,
      scope,
      state: "s1",
      code_challenge: challenge,
      code_challenge_method: "S256",
      resource,
    }))
      link.searchParams.set(k, v);
    const redirected = await fetch(link, {
      headers: session ? { cookie: session } : {},
      redirect: "manual",
    });
    return new URL(redirected.headers.get("location")!);
  }

  /** The consent page accepts with the signed query it was opened with; resolves the client's callback URL. */
  async function consent(page: URL) {
    const accepted = await fetch(new URL("/api/auth/oauth2/consent", origin), {
      method: "POST",
      headers: { cookie, "content-type": "application/json", origin: env.CORS_ORIGIN },
      body: JSON.stringify({ accept: true, oauth_query: page.search.slice(1) }),
    });
    return new URL(((await accepted.json()) as { url: string }).url);
  }

  async function exchange(callback: URL) {
    const exchanged = await fetch(new URL("/api/auth/oauth2/token", origin), {
      method: "POST",
      headers: { "content-type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        code: callback.searchParams.get("code")!,
        redirect_uri: REDIRECT,
        client_id: clientId,
        code_verifier: verifier,
        resource,
      }),
    });
    return ((await exchanged.json()) as { access_token: string }).access_token;
  }

  async function connect(accessToken: string) {
    const client = new Client({ name: "zetta-mcp-test", version: "1.0.0" });
    await client.connect(
      new StreamableHTTPClientTransport(new URL("/api/mcp", origin), {
        requestInit: { headers: { authorization: `Bearer ${accessToken}` } },
      }),
    );
    return client;
  }

  beforeAll(async () => {
    app = createApp({
      auth,
      zettaMcp: {
        auth,
        resource,
        actorFor: (id) => issueBackgroundActor(lookup, id),
        tasks,
        // Only the task, bot and output style tools run in this suite; the other services are never reached.
        chat: createChatService(db),
        outputStyles: createOutputStyles(db),
        org: createOrgStore(db),
        lessons: {
          tools: createLessonTools({
            lessons: createLessons(db, { memory: createMemory(db) }),
            progress: createProgress(db),
          }),
        },
        audit: (owner, event) => audit(db, owner, event),
        mcp: {} as never,
        connections: {} as never,
        features: {} as never,
        memory: {} as never,
      },
      webOrigin: env.CORS_ORIGIN,
      desktopOrigins: [],
    });
    const signedUp = await auth.api.signUpEmail({
      body: { name: "MCP member", email, password },
      asResponse: true,
    });
    cookie = signedUp.headers
      .getSetCookie()
      .map((c) => c.split(";")[0])
      .join("; ");
    userId = ((await signedUp.json()) as { user: { id: string } }).user.id;
    const now = new Date();
    await db.insert(membership).values({ userId, status: "active", joinedAt: now, updatedAt: now });
    await db.insert(user).values({
      id: otherId,
      name: "Other member",
      email: `${otherId}@example.invalid`,
      emailVerified: true,
      createdAt: now,
      updatedAt: now,
    });
    await db
      .insert(membership)
      .values({ userId: otherId, status: "active", joinedAt: now, updatedAt: now });
    await tasks.create((await issueBackgroundActor(lookup, userId))!, {
      title: "Migrate the CRM bot",
    });
    // Real clients arrive through CIMD (a public HTTPS metadata URL), which a loopback test cannot serve: register one directly.
    clientId = `test-client-${Bun.randomUUIDv7().slice(-12)}`;
    await db.insert(oauthClient).values({
      id: Bun.randomUUIDv7(),
      clientId,
      name: "Test MCP client",
      redirectUris: [REDIRECT],
      tokenEndpointAuthMethod: "none",
      applicationType: "native",
      grantTypes: ["authorization_code", "refresh_token"],
      responseTypes: ["code"],
      requirePKCE: true,
      createdAt: now,
      updatedAt: now,
    });
    // CIMD registration links each client to the MCP resource; tokens for an unlinked client are refused (invalid_target).
    await db
      .insert(oauthClientResource)
      .values({ id: Bun.randomUUIDv7(), clientId, resourceId: resource, createdAt: now });
  });

  afterAll(async () => {
    await db.delete(oauthClient).where(eq(oauthClient.clientId, clientId));
    await resetOrgChart(db);
    await db.delete(installationIdentity).where(eq(installationIdentity.id, 1));
    await cleanupTestUsers(db, [userId, otherId]);
    server.stop(true);
    await db.$client.end();
  });

  test("an MCP client discovers the authorization server from the protected resource", async () => {
    const challenge = await fetch(new URL("/api/mcp", origin), {
      method: "POST",
      headers: {
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(challenge.status).toBe(401);
    expect(challenge.headers.get("www-authenticate")).toContain("resource_metadata=");

    const metadata = (await (
      await fetch(new URL("/.well-known/oauth-protected-resource/api/mcp", origin))
    ).json()) as Record<string, unknown>;
    expect(metadata.resource).toBe(resource);
    expect(metadata.scopes_supported).toEqual(["mcp:read", "mcp:write"]);

    const authServer = (await (
      await fetch(new URL("/.well-known/oauth-authorization-server/api/auth", origin))
    ).json()) as Record<string, unknown>;
    expect(authServer.client_id_metadata_document_supported).toBe(true);
    expect(authServer.registration_endpoint).toBeUndefined();
  });

  // The tests below run in order: the first consent is recorded and the next ones reuse it.
  test("a signed-out member is sent to the sign-in page, and signing in there continues to consent", async () => {
    const login = await authorize("mcp:read", "");
    expect(login.origin + login.pathname).toBe("https://web.example.invalid/login");
    const signedIn = await fetch(new URL("/api/auth/sign-in/email", origin), {
      method: "POST",
      headers: { "content-type": "application/json", origin: env.CORS_ORIGIN },
      body: JSON.stringify({ email, password, oauth_query: login.search.slice(1) }),
    });
    const next = new URL(((await signedIn.json()) as { url: string }).url);
    expect(next.origin + next.pathname).toBe("https://web.example.invalid/oauth/consent");
  });

  test("on first sign-in the member consents, then the client reads their tasks", async () => {
    const page = await authorize("mcp:read");
    expect(page.origin + page.pathname).toBe("https://web.example.invalid/oauth/consent");
    const client = await connect(await exchange(await consent(page)));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name)).toContain("list_tasks");
    const result = await client.callTool({ name: "list_tasks", arguments: {} });
    const listed = JSON.parse((result.content as { text: string }[])[0]!.text) as {
      title: string;
    }[];
    expect(listed.map((t) => t.title)).toEqual(["Migrate the CRM bot"]);
    await client.close();
  });

  test("the client sees each bot's output style and the styles it can pick", async () => {
    const actor = (await issueBackgroundActor(lookup, userId))!;
    const style = await createOutputStyles(db).create(userId, {
      name: "Rhymer",
      description: "Speaks in rhyme",
      body: "Always answer in rhyme.",
    });
    await createChatService(db).createBot(actor, { name: "Voice", outputStyle: "concise" });
    await createChatService(db).createBot(actor, {
      name: "Poet",
      outputStyle: "custom",
      outputStyleId: style.id,
    });
    const client = await connect(await exchange(await authorize("mcp:read")));
    const read = async (name: string) =>
      JSON.parse(
        ((await client.callTool({ name, arguments: {} })).content as { text: string }[])[0]!.text,
      );
    const bots = (await read("list_bots")) as {
      name: string;
      outputStyle: string;
      outputStyleId: string | null;
    }[];
    expect(bots.find((b) => b.name === "Voice")).toMatchObject({
      outputStyle: "concise",
      outputStyleId: null,
    });
    expect(bots.find((b) => b.name === "Poet")).toMatchObject({
      outputStyle: "custom",
      outputStyleId: style.id,
    });
    const styles = (await read("list_output_styles")) as {
      builtins: { key: string }[];
      styles: { id: string; name: string; mine: boolean }[];
    };
    expect(styles.builtins.map((b) => b.key)).toEqual([
      "default",
      "proactive",
      "concise",
      "explanatory",
      "learning",
    ]);
    expect(styles.styles).toMatchObject([{ id: style.id, name: "Rhymer", mine: true }]);
    await client.close();
  });

  test("a read-only token cannot create, change or delete a style", async () => {
    const client = await connect(await exchange(await authorize("mcp:read")));
    await expect(
      client.callTool({ name: "create_output_style", arguments: { name: "Blocked", body: "No." } }),
    ).rejects.toThrow();
    const styles = JSON.parse(
      (
        (await client.callTool({ name: "list_output_styles", arguments: {} })).content as {
          text: string;
        }[]
      )[0]!.text,
    ) as { styles: { name: string }[] };
    expect(styles.styles.map((x) => x.name)).not.toContain("Blocked");
    await client.close();
  });

  test("a token with the write scope manages styles and bot styles, and every write is audited", async () => {
    const page = await authorize("mcp:read mcp:write");
    const client = await connect(await exchange(await consent(page)));
    const call = async (name: string, args: Record<string, unknown>) => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { text: string }[])[0]!.text;
      return { isError: r.isError === true, text, json: r.isError ? undefined : JSON.parse(text) };
    };
    const actor = (await issueBackgroundActor(lookup, userId))!;
    const bot = (await createChatService(db).createBot(actor, { name: "Writer" }))!;

    const created = await call("create_output_style", {
      name: "Calm",
      body: "Speak slowly.",
      scope: "installation",
    });
    const id = created.json.style.id as string;
    expect(created.json.style).toMatchObject({ name: "Calm", scope: "installation", version: 1 });

    const updated = await call("update_output_style", {
      id,
      expectedVersion: 1,
      body: "Speak slowly and kindly.",
    });
    expect(updated.json.style).toMatchObject({ body: "Speak slowly and kindly.", version: 2 });

    const set = await call("set_bot_output_style", {
      botId: bot.id,
      expectedVersion: 1,
      outputStyle: "custom",
      outputStyleId: id,
    });
    expect(set.json.bot).toMatchObject({ outputStyle: "custom", outputStyleId: id });

    const missingId = await call("set_bot_output_style", {
      botId: bot.id,
      expectedVersion: 2,
      outputStyle: "custom",
    });
    expect(missingId).toMatchObject({ isError: true, text: "INVALID" });

    const builtin = await call("set_bot_output_style", {
      botId: bot.id,
      expectedVersion: 2,
      outputStyle: "learning",
    });
    expect(builtin.json.bot).toMatchObject({ outputStyle: "learning", outputStyleId: null });

    expect((await call("export_output_style", { id })).json).toEqual({
      filename: "calm.md",
      markdown: '---\nname: "Calm"\ndescription: ""\n---\n\nSpeak slowly and kindly.\n',
    });
    expect((await call("export_output_style", { builtin: "learning" })).text).toContain(
      'name: \\"Learning\\"',
    );
    expect((await call("export_output_style", {})).isError).toBe(true);

    const imported = await call("import_output_style", {
      markdown: "---\nname: Imported\n---\nBe brief.",
    });
    expect(imported.json.style).toMatchObject({
      name: "Imported",
      scope: "private",
      body: "Be brief.",
    });
    expect((await call("archive_output_style", { id: imported.json.style.id })).json).toEqual({
      id: imported.json.style.id,
    });
    const listed = JSON.parse((await call("list_output_styles", {})).text) as {
      styles: { name: string }[];
    };
    expect(listed.styles.map((x) => x.name)).toContain("Calm");
    expect(listed.styles.map((x) => x.name)).not.toContain("Imported");

    const rows = (
      await db.$client.query(
        "select detail, outcome from audit_event where owner_user_id = $1 and detail like 'mcp:%' order by id",
        [userId],
      )
    ).rows as { detail: string; outcome: string }[];
    expect(rows).toEqual([
      { detail: "mcp:create_output_style", outcome: "ok" },
      { detail: "mcp:update_output_style", outcome: "ok" },
      { detail: "mcp:set_bot_output_style", outcome: "ok" },
      { detail: "mcp:set_bot_output_style", outcome: "failed" },
      { detail: "mcp:set_bot_output_style", outcome: "ok" },
      { detail: "mcp:import_output_style", outcome: "ok" },
      { detail: "mcp:archive_output_style", outcome: "ok" },
    ]);
    await client.close();
  });

  /** Makes this member the administrator of the installation (the lookup reads it on every request). */
  const adminIs = (id: string) =>
    db
      .insert(installationIdentity)
      .values({ id: 1, adminUserId: id, bootstrappedAt: new Date() })
      .onConflictDoUpdate({ target: installationIdentity.id, set: { adminUserId: id } });
  /** A token that has already consented (the earlier tests recorded it) comes back with the callback at once. */
  const writeToken = async () => {
    const first = await authorize("mcp:read mcp:write");
    return exchange(first.origin + first.pathname === REDIRECT ? first : await consent(first));
  };
  const caller =
    (client: Awaited<ReturnType<typeof connect>>) =>
    async (name: string, args: Record<string, unknown> = {}) => {
      const r = await client.callTool({ name, arguments: args });
      const text = (r.content as { text: string }[])[0]!.text;
      return { isError: r.isError === true, text, json: r.isError ? undefined : JSON.parse(text) };
    };

  test("lessons: any member reads what their bots learned, changing it is a write, and only their own lessons can be named", async () => {
    const client = await connect(await writeToken());
    const call = caller(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const tool of ["list_lessons", "get_lessons_progress", "change_lessons"])
      expect(names).toContain(tool);
    expect((await call("list_lessons")).json).toEqual({ lessons: "No lessons match." });
    // A bot that is not the member's is not found, and a lesson that is not theirs is "not done", never a change.
    expect(
      (await call("get_lessons_progress", { bot: "0194f0aa-1111-7000-8000-00000000000a" })).isError,
    ).toBe(true);
    const changed = await call("change_lessons", {
      action: "drop",
      ids: ["0194f0aa-1111-7000-8000-00000000000a"],
    });
    expect(changed.json.result).toContain(": not done (");
    expect((await call("change_lessons", { action: "drop", ids: [] })).isError).toBe(true);
    expect((await call("list_lessons", { label: "wrong" })).isError).toBe(true);
    await client.close();
  });

  test("a member who is not the administrator reads the company chart and gets no tool to change it", async () => {
    await adminIs(otherId);
    const client = await connect(await writeToken());
    const names = (await client.listTools()).tools.map((t) => t.name);
    expect(names).toContain("get_org_chart");
    for (const writer of [
      "add_org_seat",
      "update_org_seat",
      "move_org_seat",
      "set_org_seat_holder",
      "remove_org_seat",
      "apply_org_template",
    ])
      expect(names).not.toContain(writer);
    const chart = await caller(client)("get_org_chart");
    expect(chart.json).toMatchObject({ canEdit: false, chart: { version: 0 }, positions: [] });
    expect(chart.json.candidates).toBeUndefined();
    await client.close();
  });

  test("the administrator's token with the write scope draws the chart, stale edits are turned away, and every change is audited", async () => {
    await adminIs(userId);
    await resetOrgChart(db);
    const client = await connect(await writeToken());
    const call = caller(client);
    const names = (await client.listTools()).tools.map((t) => t.name);
    for (const writer of [
      "add_org_seat",
      "update_org_seat",
      "move_org_seat",
      "set_org_seat_holder",
      "remove_org_seat",
      "apply_org_template",
    ])
      expect(names).toContain(writer);

    const empty = await call("get_org_chart");
    expect(empty.json).toMatchObject({ canEdit: true, chart: { version: 0 } });
    expect(empty.json.candidates.people.map((p: { userId: string }) => p.userId)).toContain(userId);

    const ceo = await call("add_org_seat", { expectedVersion: 0, templateKey: "ceo" });
    expect(ceo.json.org.positions).toHaveLength(1);
    const ceoId = ceo.json.org.positions[0].id as string;
    const version = () => call("get_org_chart").then((r) => r.json.chart.version as number);

    const cto = await call("add_org_seat", {
      expectedVersion: await version(),
      parentId: ceoId,
      templateKey: "cto",
      unit: "Tech",
    });
    const ctoId = cto.json.org.positions.find((p: { title: string }) => p.title === "CTO")
      .id as string;
    const named = await call("update_org_seat", {
      id: ctoId,
      expectedVersion: await version(),
      title: "Head of technology",
      rank: "lead",
    });
    expect(named.json.org.positions.find((p: { id: string }) => p.id === ctoId)).toMatchObject({
      title: "Head of technology",
      rank: "lead",
      unit: "Tech",
    });
    const held = await call("set_org_seat_holder", {
      id: ctoId,
      expectedVersion: await version(),
      holder: { kind: "person", userId },
    });
    expect(
      held.json.org.positions.find((p: { id: string }) => p.id === ctoId).holder,
    ).toMatchObject({
      kind: "person",
      userId,
    });
    const cfo = await call("add_org_seat", {
      expectedVersion: await version(),
      parentId: ceoId,
      templateKey: "cfo",
    });
    const cfoId = cfo.json.org.positions.find((p: { title: string }) => p.title === "CFO")
      .id as string;
    const moved = await call("move_org_seat", {
      id: cfoId,
      expectedVersion: await version(),
      parentId: ceoId,
      index: 0,
    });
    const under = (
      moved.json.org.positions as { parentId: string | null; title: string; sortOrder: number }[]
    )
      .filter((p) => p.parentId === ceoId)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((p) => p.title);
    expect(under).toEqual(["CFO", "Head of technology"]);

    // A loop is refused in words, and a stale version is turned away with the latest chart to read.
    const loop = await call("move_org_seat", {
      id: ceoId,
      expectedVersion: await version(),
      parentId: ctoId,
    });
    expect(loop).toMatchObject({ isError: true });
    const stale = await call("add_org_seat", {
      expectedVersion: 0,
      templateKey: "cmo",
      parentId: ceoId,
    });
    expect(stale).toMatchObject({
      isError: true,
      text: "Someone changed the chart. Here is the latest; try again.",
    });
    const removed = await call("remove_org_seat", { id: cfoId, expectedVersion: await version() });
    expect(removed.json.org.positions.find((p: { id: string }) => p.id === cfoId)).toBeUndefined();

    const rows = (
      await db.$client.query(
        "select detail, outcome from audit_event where owner_user_id = $1 and detail like 'mcp:%org%' order by id",
        [userId],
      )
    ).rows as { detail: string; outcome: string }[];
    expect(rows.map((r) => `${r.detail}:${r.outcome}`)).toEqual([
      "mcp:add_org_seat:ok",
      "mcp:add_org_seat:ok",
      "mcp:update_org_seat:ok",
      "mcp:set_org_seat_holder:ok",
      "mcp:add_org_seat:ok",
      "mcp:move_org_seat:ok",
      "mcp:move_org_seat:failed",
      "mcp:add_org_seat:failed",
      "mcp:remove_org_seat:ok",
    ]);
    await client.close();
  });

  test("a read-only token of the administrator can read the chart and cannot change it", async () => {
    await adminIs(userId);
    const first = await authorize("mcp:read");
    const client = await connect(
      await exchange(first.origin + first.pathname === REDIRECT ? first : await consent(first)),
    );
    expect((await caller(client)("get_org_chart")).json).toMatchObject({ canEdit: true });
    await expect(
      client.callTool({
        name: "add_org_seat",
        arguments: { expectedVersion: 0, templateKey: "ceo" },
      }),
    ).rejects.toThrow();
    await client.close();
    // The tests that follow remove this member: the administrator cannot be removed, so the role goes back to the other member.
    await adminIs(otherId);
  });

  test("a later sign-in with the same scopes skips the consent page", async () => {
    const callback = await authorize("mcp:read");
    expect(callback.origin + callback.pathname).toBe(REDIRECT);
    expect(callback.searchParams.get("code")).toBeTruthy();
  });

  test("a removed member's token stops working", async () => {
    const accessToken = await exchange(await authorize("mcp:read"));
    const now = new Date();
    await db
      .update(membership)
      .set({ status: "removed", removedAt: now, updatedAt: now })
      .where(eq(membership.userId, userId));
    try {
      const refused = await fetch(new URL("/api/mcp", origin), {
        method: "POST",
        headers: {
          authorization: `Bearer ${accessToken}`,
          "content-type": "application/json",
          accept: "application/json, text/event-stream",
        },
        body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
      });
      expect(refused.status).toBe(403);
      expect(await refused.json()).toEqual({ error: "inactive_member" });
    } finally {
      await db
        .update(membership)
        .set({ status: "active", removedAt: null, updatedAt: now })
        .where(eq(membership.userId, userId));
    }
  });
  // Last: consenting to other scopes replaces the member's stored consent.
  test("a token without mcp:read is refused with a step-up challenge", async () => {
    const accessToken = await exchange(await consent(await authorize("openid")));
    const refused = await fetch(new URL("/api/mcp", origin), {
      method: "POST",
      headers: {
        authorization: `Bearer ${accessToken}`,
        "content-type": "application/json",
        accept: "application/json, text/event-stream",
      },
      body: JSON.stringify({ jsonrpc: "2.0", id: 1, method: "tools/list" }),
    });
    expect(refused.status).toBe(403);
    expect(refused.headers.get("www-authenticate")).toContain('error="insufficient_scope"');
  });
});
