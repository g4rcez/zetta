import { getCopy, type Copy, type Locale } from "../i18n";
import { DOCS, INSTALL, ISSUES, LICENSE, REPO, SITE } from "../links";

/** A heading made of its three parts ("Watch a brief become " + "a working team" + ""), as one line of plain text. */
const joined = (t: { before: string; mark: string; after: string }) =>
  `${t.before}${t.mark}${t.after}`.replace(/\s+/g, " ").trim();

/** The home page's words as Markdown, in the order the page shows them. It has no pictures: the alt text carries what they show. */
export function pageMarkdown(locale: Locale): string {
  const c: Copy = getCopy(locale);
  const out: string[] = [];
  const add = (...lines: string[]) => out.push(...lines, "");

  add(
    `# ${joined({ before: c.hero.title.before, mark: c.hero.title.mark, after: c.hero.title.after })} ${c.hero.title.rest}`,
  );
  add(c.hero.lead);
  add(`> ${c.hero.note}`);
  add(c.hero.proof.map((p) => `- ${p}`).join("\n"));
  add(`${c.hero.installLabel}:`, "", "```sh", `curl -fsSL ${INSTALL} | bash`, "```");

  add(`${c.pain.before}${c.pain.mark}${c.pain.after}`.trim());

  add(`## ${joined(c.features.title)}`, c.features.lead);
  for (const t of c.features.tiles) add(`### ${t.tag}: ${t.title}`, t.body);

  add(`## ${c.engines.title.before}${c.engines.title.mark}${c.engines.title.after}`.trim());
  add(c.engines.lead);
  add(`${c.engines.badge}: ${c.engines.agents.join(", ")}.`);
  for (const g of c.engines.groups)
    add(`### ${g.title}`, g.body, ...(g.tags.length ? [g.tags.join(", ")] : []));

  add(`## ${joined(c.chief.title)}`, c.chief.lead);
  add(...c.chief.points.map((p) => `- **${p.title}.** ${p.body}`));
  add(`### ${c.chief.capsTitle}`);
  add(...c.chief.caps.map((p) => `- **${p.title}.** ${p.body}`));

  add(`## ${joined(c.install.title)}`, c.install.lead);
  add(...c.install.steps.map((s, i) => `${i + 1}. **${s.title}.** ${s.body}`));
  add(`${c.install.manual.summary} ${c.install.manual.body} [${c.install.manual.docs}](${DOCS}).`);
  add(`> ${c.install.note}`);

  add(`## ${joined(c.faq.title)}`);
  for (const f of c.faq.items) add(`### ${f.q}`, f.a);

  add(`## ${joined(c.cta.title)}`, c.cta.lead);
  add(
    `- [${c.footer.links.repo}](${REPO})`,
    `- [${c.footer.links.docs}](${DOCS})`,
    `- [${c.footer.links.issues}](${ISSUES})`,
    `- [${c.footer.license}](${LICENSE})`,
  );
  add(`${c.footer.tagline} ${SITE}`);
  return `${out.join("\n").trimEnd()}\n`;
}
