import { StateEffect, type Extension } from "@codemirror/state";
import {
  Decoration,
  EditorView,
  MatchDecorator,
  ViewPlugin,
  WidgetType,
  type DecorationSet,
  type ViewUpdate,
} from "@codemirror/view";
import { MENTION_TOKEN_SOURCE, unescapeMentionLabel, type MentionKind } from "@zetta/core/mentions";

/** Tells the chips that the names changed (bots loaded, a rename): they draw again. */
export const refreshMentionChips = StateEffect.define<null>();

class Chip extends WidgetType {
  constructor(
    readonly kind: MentionKind,
    readonly text: string,
  ) {
    super();
  }
  override eq(other: Chip) {
    return other.kind === this.kind && other.text === this.text;
  }
  override toDOM() {
    const el = document.createElement("span");
    el.className = `cm-mention cm-mention-${this.kind}`;
    el.textContent = this.text;
    return el;
  }
}

/**
 * Draws each mention token (`[@Dev](bot:<id>)`, see `@zetta/core/mentions`) as one chip with the current name from `nameOf`, or the
 * label of the token when the id is unknown. The text stays the token: copying, saving and the hidden form field see Markdown.
 * A chip is one unit for the caret, so Backspace removes the whole mention.
 */
export function mentionChips(nameOf: (id: string) => string | undefined): Extension {
  const decorator = new MatchDecorator({
    regexp: new RegExp(MENTION_TOKEN_SOURCE, "gi"),
    decoration: (m) => {
      const kind = m[3]!.toLowerCase() as MentionKind;
      // The sigil must fit the kind, as in parseMentions: `[#Dev](bot:…)` is an ordinary link.
      if ((kind === "bot") !== (m[1] === "@")) return null;
      const name = nameOf(m[4]!.toLowerCase()) ?? unescapeMentionLabel(m[2]!);
      return Decoration.replace({ widget: new Chip(kind, `${m[1]}${name}`) });
    },
  });
  const plugin = ViewPlugin.fromClass(
    class {
      decorations: DecorationSet;
      constructor(view: EditorView) {
        this.decorations = decorator.createDeco(view);
      }
      update(u: ViewUpdate) {
        this.decorations = u.transactions.some((t) =>
          t.effects.some((e) => e.is(refreshMentionChips)),
        )
          ? decorator.createDeco(u.view)
          : decorator.updateDeco(u, this.decorations);
      }
    },
    {
      decorations: (v) => v.decorations,
      provide: (p) =>
        EditorView.atomicRanges.of((view) => view.plugin(p)?.decorations ?? Decoration.none),
    },
  );
  return plugin;
}
