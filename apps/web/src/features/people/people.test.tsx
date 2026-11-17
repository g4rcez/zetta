import { expect, test } from "bun:test";
import { QueryClient, QueryClientProvider } from "@tanstack/react-query";
import { act, type ReactNode } from "react";
import { createRoot } from "react-dom/client";

import { setupDom } from "../skills/dom-env";

const win = setupDom();
Object.assign(globalThis, { scrollTo: () => {} });

const ADA = {
  userId: "u-ada",
  name: "Ada Lovelace",
  avatar: null,
  jobTitle: "Head of design",
  title: "Head of design",
  department: "Product",
  about: "I draw boxes.\nAnd arrows.",
  contact: "ada@example.invalid",
};
// Wrote no job title: the server fills `title` with the title of the seat they hold in the company chart.
const BOB = {
  userId: "u-bob",
  name: "Bob Stone",
  avatar: null,
  jobTitle: "",
  title: "Chief of staff",
  department: "",
  about: "",
  contact: "",
};
const NOBODY = {
  userId: "u-cy",
  name: "Cy Moss",
  avatar: null,
  jobTitle: "",
  title: "",
  department: "",
  about: "",
  contact: "",
};
const requests: string[] = [];
globalThis.fetch = (async (input: URL | Request | string) => {
  const url = new URL(input instanceof Request ? input.url : String(input));
  requests.push(`${url.pathname}${url.search}`);
  if (url.pathname === "/api/people") {
    const q = (url.searchParams.get("q") ?? "").toLowerCase();
    const all = [ADA, BOB, NOBODY];
    return Response.json({
      people: all.filter(
        (p) => !q || `${p.name} ${p.title} ${p.department}`.toLowerCase().includes(q),
      ),
    });
  }
  if (url.pathname === "/api/teams/t1/people")
    return Response.json({
      people: [
        { userId: "u-owner", name: "Olga Owner", role: "owner", avatar: null, title: "Founder" },
        { userId: BOB.userId, name: BOB.name, role: "member", avatar: null, title: BOB.title },
        { userId: NOBODY.userId, name: NOBODY.name, role: "member", avatar: null, title: "" },
      ],
    });
  if (url.pathname === "/api/teams/t1/candidates")
    return Response.json({
      candidates: [{ userId: ADA.userId, name: ADA.name, avatar: null, title: ADA.title }],
    });
  return Response.json(
    { error: { code: "TEST", message: `unexpected ${url.pathname}` } },
    { status: 500 },
  );
}) as typeof fetch;

const settle = (ms = 60) => act(async () => void (await new Promise((r) => setTimeout(r, ms))));
const text = () => win.document.body.textContent ?? "";

async function mount(ui: ReactNode) {
  requests.length = 0;
  const { createMemoryHistory, createRootRoute, createRouter, RouterProvider } =
    await import("@tanstack/react-router");
  const router = createRouter({
    routeTree: createRootRoute({
      component: () => (
        <QueryClientProvider
          client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}
        >
          {ui}
        </QueryClientProvider>
      ),
    }),
    history: createMemoryHistory({ initialEntries: ["/"] }),
  });
  await router.load();
  const host = win.document.createElement("div");
  win.document.body.replaceChildren(host);
  await act(async () =>
    createRoot(host as unknown as Element).render(<RouterProvider router={router} />),
  );
  await settle();
  return host;
}

test("PersonIdentity shows the name and the title under it, and a title line given by the caller replaces it", async () => {
  const { PersonIdentity } = await import("@/components/person-identity");
  const host = await mount(
    <div>
      <section aria-label="a">
        <PersonIdentity person={{ name: "Ada Lovelace", title: "Head of design" }} />
      </section>
      <section aria-label="b">
        <PersonIdentity person={{ name: "Bob Stone", title: "Chief of staff" }} sub="Assigned to" />
      </section>
      <section aria-label="c">
        <PersonIdentity person={{ name: "Cy Moss", title: "" }} />
      </section>
    </div>,
  );
  const a = host.querySelector('[aria-label="a"]')!.textContent;
  const b = host.querySelector('[aria-label="b"]')!.textContent;
  const c = host.querySelector('[aria-label="c"]')!.textContent;
  expect(a).toBe("AAda LovelaceHead of design");
  expect(b).toBe("BBob StoneAssigned to");
  expect(c).toBe("CCy Moss");
});

test("with a card, a click opens the person's department, about and contact", async () => {
  const { PersonIdentity } = await import("@/components/person-identity");
  const host = await mount(
    <PersonIdentity card person={{ userId: ADA.userId, name: ADA.name, title: ADA.title }} />,
  );
  expect(requests).not.toContain("/api/people");
  const trigger = host.querySelector("button") as unknown as HTMLButtonElement;
  expect(trigger.getAttribute("aria-label")).toBe("Ada Lovelace: open profile");
  await act(
    async () => void trigger.dispatchEvent(new win.MouseEvent("click", { bubbles: true }) as never),
  );
  await settle(120);
  expect(requests).toContain("/api/people");
  const card = win.document.querySelector('[aria-label="Profile of Ada Lovelace"]');
  expect(card?.textContent).toContain("Department");
  expect(card?.textContent).toContain("Product");
  expect(card?.textContent).toContain("I draw boxes.");
  expect(card?.textContent).toContain("ada@example.invalid");
});

test("without an id there is nothing to open: the row is plain", async () => {
  const { PersonIdentity } = await import("@/components/person-identity");
  const host = await mount(<PersonIdentity card person={{ name: "Someone" }} />);
  expect(host.querySelector("button")).toBeNull();
});

test("the People page lists members with title, department, contact and about, and the seat title stands in for a missing job title", async () => {
  const { PeoplePage } = await import("./people-page");
  await mount(<PeoplePage search={{}} setSearch={() => {}} />);
  expect(requests).toEqual(["/api/people"]);
  const t = text();
  expect(t).toContain("Ada Lovelace");
  expect(t).toContain("Head of design");
  expect(t).toContain("Product");
  expect(t).toContain("ada@example.invalid");
  expect(t).toContain("I draw boxes.");
  expect(t).toContain("Bob Stone");
  expect(t).toContain("Chief of staff");
  expect(t).toContain("Cy Moss");
});

test("the search of the People page comes from the address: a value in ?q= is shown and loaded with no click", async () => {
  const { PeoplePage } = await import("./people-page");
  await mount(<PeoplePage search={{ q: "design" }} setSearch={() => {}} />);
  expect(requests).toEqual(["/api/people?q=design"]);
  const box = win.document.querySelector('input[type="search"]') as unknown as HTMLInputElement;
  expect(box.value).toBe("design");
  expect(text()).toContain("Ada Lovelace");
  expect(text()).not.toContain("Bob Stone");
});

test("typing in the search writes it to the address, and an empty box leaves it", async () => {
  const { PeoplePage } = await import("./people-page");
  const writes: unknown[] = [];
  await mount(<PeoplePage search={{}} setSearch={(p) => void writes.push(p)} />);
  const box = win.document.querySelector('input[type="search"]') as unknown as HTMLInputElement;
  const props = (box as unknown as Record<string, { onChange?: (e: unknown) => void }>)[
    Object.keys(box).find((k) => k.startsWith("__reactProps"))!
  ]!;
  const type = async (value: string) => {
    await act(async () => {
      Object.getOwnPropertyDescriptor(win.HTMLInputElement.prototype, "value")!.set!.call(
        box,
        value,
      );
      props.onChange!({ target: box, currentTarget: box });
    });
  };
  await type("  chief ");
  await type("");
  expect(writes).toEqual([{ q: "chief" }, { q: undefined }]);
});

test("a search nobody matches says so", async () => {
  const { PeoplePage } = await import("./people-page");
  await mount(<PeoplePage search={{ q: "zzz" }} setSearch={() => {}} />);
  expect(text()).toContain("No one matches that search.");
});

test("the people of a team show their title under the name, and the Add a person list carries titles", async () => {
  const { TeamPeoplePanel } = await import("../teams/team-people");
  const host = await mount(<TeamPeoplePanel teamId="t1" />);
  const rows = [...host.querySelectorAll("li")].map((li) => li.textContent ?? "");
  expect(rows[0]).toContain("Olga Owner");
  expect(rows[0]).toContain("Founder");
  expect(rows[0]).toContain("Owner");
  expect(rows[1]).toContain("Chief of staff");
  expect(rows[2]).toContain("Cy Moss");
  const options = [...host.querySelectorAll("option")].map((o) => o.textContent);
  expect(options).toContain("Ada Lovelace · Head of design");
});

test("the project member picker draws each person with the title under the name", async () => {
  const { MemberPicker } = await import("../projects/member-picker");
  const host = await mount(
    <MemberPicker
      candidates={{
        bots: [],
        people: [
          { userId: BOB.userId, name: BOB.name, title: BOB.title },
          { userId: "u-x", name: "Xi" },
        ],
        rooms: [],
      }}
      identities={new Map()}
      bots={[]}
      people={[]}
      onBots={() => {}}
      onPeople={() => {}}
    />,
  );
  const people = host.querySelectorAll("fieldset")[1]!.textContent ?? "";
  expect(people).toContain("Bob Stone");
  expect(people).toContain("Chief of staff");
  expect(people).toContain("Xi");
});

test("a person on a seat shows their own job title on the seat's page, and the small chart forms stay one line", async () => {
  const { SeatHolder } = await import("../org/org-bits");
  const item = {
    holder: {
      kind: "person" as const,
      userId: ADA.userId,
      name: ADA.name,
      avatar: null,
      jobTitle: "Head of design",
    },
    problem: null,
  };
  const big = await mount(<SeatHolder item={item} size={36} />);
  expect(big.textContent).toContain("Head of design");
  const small = await mount(<SeatHolder item={item} size={24} />);
  expect(small.textContent).toBe("AAda Lovelace");
});

test("the address parser keeps a trimmed search and drops anything else", async () => {
  const { parsePeopleSearch, withPeopleSearch } = await import("./people-search");
  expect(parsePeopleSearch({ q: "  ada " })).toEqual({ q: "ada" });
  expect(parsePeopleSearch({ q: "" })).toEqual({});
  expect(parsePeopleSearch({ q: 42, other: "x" })).toEqual({});
  expect(withPeopleSearch({ q: "ada" }, { q: undefined })).toEqual({});
});
