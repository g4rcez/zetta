import { code } from "@streamdown/code";
import { Streamdown } from "streamdown";

import { fence } from "./code-fence";

/** Syntax highlighting (Shiki) for the code blocks Streamdown draws. Themes follow the page: `github-light` and `github-dark`. */
export const codePlugins = { code };

/** A file or snippet as one highlighted block, with Streamdown's copy and download buttons. */
export function HighlightedCode({ text, language }: { text: string; language: string }) {
  return (
    <Streamdown mode="static" plugins={codePlugins} className="chat-response">
      {fence(text, language)}
    </Streamdown>
  );
}
