import readme from "../../../../README.md?raw";

import changelog from "../data/changelog.json";
import { getCopy } from "../i18n";
import type { ChangelogDay } from "./changelog";
import { guidePages } from "./guide";
import { buildLlmsFull, buildLlmsTxt } from "./llms-md";
import { pageMarkdown } from "./page-md";
import { readmeMarkdown } from "./readme";

const days = changelog as ChangelogDay[];

export const llmsTxt = () =>
  buildLlmsTxt({ description: getCopy("en").meta.description, guides: guidePages() });

export const llmsFull = () =>
  buildLlmsFull({
    home: pageMarkdown("en"),
    readme: readmeMarkdown(readme),
    guides: guidePages(),
    days,
  });
