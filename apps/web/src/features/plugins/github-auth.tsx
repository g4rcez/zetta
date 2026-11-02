import { KeyIcon, TerminalWindowIcon } from "@phosphor-icons/react";

import { linkParts } from "../chat/setup-card-data";
import { ChoiceBoxes } from "./choice-boxes";

export type GithubMethod = "cli" | "token";

// The bot reads the server's own guide (plugins/catalog.ts); these are the same steps, split by method for the person.
const STEPS: Record<GithubMethod, string[]> = {
  cli: [
    "On the machine that runs the Zetta server, run: gh auth login",
    "Choose github.com and finish the sign-in in the browser.",
    "Zetta checks the login: the status shows Connected when it works.",
  ],
  token: [
    "Open https://github.com/settings/personal-access-tokens/new to create a fine-grained token.",
    "Pick only the repositories the bot may touch.",
    "Grant read access to Contents, Issues and Pull requests (write access only if the bot must change things).",
    "Generate the token, copy it, and paste it in the field below. Do not paste it in the chat.",
  ],
};

/** How GitHub is connected: the CLI login already on the server (no token to keep) or a personal access token. */
export function GithubAuth({
  method,
  onChange,
}: {
  method: GithubMethod;
  onChange: (m: GithubMethod) => void;
}) {
  return (
    <div className="space-y-2">
      <ChoiceBoxes
        label="Sign-in method"
        value={method}
        onChange={onChange}
        options={[
          {
            value: "cli",
            label: "GitHub CLI",
            badge: "Recommended",
            icon: TerminalWindowIcon,
            hint: "Bots use git and gh with the login the server already has. No token to create or store.",
          },
          {
            value: "token",
            label: "Access token",
            icon: KeyIcon,
            hint: "Use it when the server has no CLI login, or for the GitHub tools (search, issues, pull requests).",
          },
        ]}
      />
      <ol className="list-decimal space-y-1 pl-5 text-xs text-muted-foreground">
        {STEPS[method].map((s) => (
          <li key={s}>
            {linkParts(s).map((p, i) =>
              p.href ? (
                <a
                  key={i}
                  href={p.href}
                  target="_blank"
                  rel="noopener noreferrer"
                  className="break-all underline"
                >
                  {p.text}
                </a>
              ) : (
                <span key={i}>{p.text}</span>
              ),
            )}
          </li>
        ))}
      </ol>
    </div>
  );
}
