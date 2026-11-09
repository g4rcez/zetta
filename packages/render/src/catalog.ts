import { defineCatalog } from "@json-render/core";
import { schema } from "@json-render/react/schema";
import { z } from "zod";

const tone = z.enum(["default", "muted", "info", "success", "warning", "danger"]);
const text = (n: number) => z.string().max(n);
/** Links the chat will follow: public web addresses only, never javascript: or data: URLs. */
const httpUrl = z
  .string()
  .max(2000)
  .refine((v) => /^https?:\/\//i.test(v), "must start with http:// or https://");

const label = text(60);
/** Same field names as `@json-render/chat`'s Chart, so one spec draws on the web and converts to a chat card; the caps are ours. */
const pieChart = z.object({
  type: z.enum(["pie"]),
  segments: z
    .array(z.object({ label, value: z.number().min(0) }))
    .min(1)
    .max(12),
});
const axisChart = z
  .object({
    type: z.enum(["bar", "line", "area"]),
    categories: z.array(label).min(1).max(50),
    series: z
      .array(z.object({ name: label, values: z.array(z.number()).min(1).max(50) }))
      .min(1)
      .max(8),
    xLabel: label.nullish(),
    yLabel: label.nullish(),
  })
  .refine(
    (c) => c.series.every((s) => s.values.length === c.categories.length),
    "each series needs one value per category",
  );

/**
 * What a bot may draw in the chat. Display only: no inputs, no actions, so a spec can never do anything but render.
 * Both sides import this one definition: the server turns it into the bot prompt, the web registry implements every entry.
 */
export const catalog = defineCatalog(schema, {
  components: {
    Stack: {
      props: z.object({
        direction: z.enum(["vertical", "horizontal"]).nullish(),
        gap: z.enum(["sm", "md", "lg"]).nullish(),
      }),
      slots: ["default"],
      description: "Lays its children out in a column (default) or a wrapping row.",
    },
    Card: {
      props: z.object({ title: text(120).nullish(), description: text(300).nullish() }),
      slots: ["default"],
      description: "Bordered container with an optional title. Use as the root for most answers.",
    },
    Heading: {
      props: z.object({ text: text(160), level: z.enum(["1", "2", "3"]).nullish() }),
      description: "Section heading.",
    },
    Text: {
      props: z.object({ text: text(2000), tone: tone.nullish() }),
      description: "A short paragraph of plain text (no markdown).",
    },
    Badge: {
      props: z.object({ label: text(40), tone: tone.nullish() }),
      description: "Small status pill.",
    },
    Metric: {
      props: z.object({
        label: text(60),
        value: text(40),
        hint: text(120).nullish(),
        trend: z.enum(["up", "down", "flat"]).nullish(),
      }),
      description: "One headline number with a label, e.g. revenue or latency.",
    },
    KeyValue: {
      props: z.object({
        items: z
          .array(z.object({ label: text(60), value: text(300) }))
          .min(1)
          .max(30),
      }),
      description: "Aligned label/value pairs such as properties or details.",
    },
    Table: {
      props: z.object({
        columns: z.array(text(60)).min(1).max(12),
        rows: z.array(z.array(text(300)).max(12)).max(100),
      }),
      description: "Rows of text cells; each row has one cell per column.",
    },
    List: {
      props: z.object({ items: z.array(text(300)).min(1).max(50), ordered: z.boolean().nullish() }),
      description: "Bulleted or numbered list of short items.",
    },
    Alert: {
      props: z.object({
        title: text(120).nullish(),
        message: text(600),
        tone: z.enum(["info", "success", "warning", "danger"]).nullish(),
      }),
      description: "Callout box for a notice, warning or result.",
    },
    Progress: {
      props: z.object({ label: text(80).nullish(), value: z.number().min(0).max(100) }),
      description: "Progress bar, value is a percentage from 0 to 100.",
    },
    Chart: {
      props: z.object({ title: text(120), chart: z.union([pieChart, axisChart]) }),
      description: "Pie, bar, line or area chart; every series has one value per category.",
    },
    Code: {
      props: z.object({ code: text(8000), language: text(30).nullish() }),
      description: "Preformatted code or log output.",
    },
    Link: {
      props: z.object({ label: text(120), href: httpUrl }),
      description: "Link to a public web page (http or https only).",
    },
    Divider: { props: z.object({}), description: "Thin horizontal rule between sections." },
  },
  actions: {},
});

export type Catalog = typeof catalog;
export type ComponentName = keyof Catalog["data"]["components"];
