import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

import { fence } from "./code-fence";
import { PeleDiagram } from "./diagram";

/** Syntax highlighting (Shiki) for the code blocks Streamdown draws. Themes follow the page: `github-light` and `github-dark`. */
export const codePlugins = { code };

/** `codePlugins` plus Mermaid diagrams drawn by Pele. A reply that is still streaming keeps `codePlugins`: the diagram's text is not whole yet. */
export const diagramPlugins = {
  ...codePlugins,
  renderers: [{ language: "mermaid", component: PeleDiagram }],
};

/** A file or snippet as one highlighted block, with Streamdown's copy and download buttons. */
export function HighlightedCode({ text, language }: { text: string; language: string }) {
  return (
    <Streamdown mode="static" plugins={diagramPlugins} className="chat-response">
      {fence(text, language)}
    </Streamdown>
  );
}
