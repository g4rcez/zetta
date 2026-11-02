/** `owner/repo` or a link from GitHub or skills.sh: browse that repository. Anything else typed in the box is a search. */
export const looksLikeSource = (text: string) =>
  /^(https?:\/\/|github\.com\/|skills\.sh\/)|^[\w.-]+\/[\w.-]+/i.test(text.trim());
