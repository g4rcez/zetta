/** Scripts that run inside a page through `agent-browser eval`; they describe inputs and never read their values. */
export type FocusedInput = {
  tag: string;
  type: string;
  autocomplete: string;
  name: string;
  inputmode: string;
};
/** Page script for `focused()`: never reads the element's value. */
export const FOCUSED_JS = `(() => { let e = document.activeElement; while (e && e.shadowRoot && e.shadowRoot.activeElement) e = e.shadowRoot.activeElement; if (!e || e === document.body) return null;
  const a = (k) => String(e.getAttribute(k) || '').toLowerCase().slice(0, 80);
  return { tag: e.tagName.toLowerCase(), type: e.tagName === 'INPUT' ? String(e.type || 'text').toLowerCase() : '', autocomplete: a('autocomplete'), name: [a('name'), a('id'), a('aria-label'), a('placeholder')].join(' ').trim(), inputmode: a('inputmode') }; })()`;
