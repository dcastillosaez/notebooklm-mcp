/**
 * NotebookLM host helpers.
 *
 * Google renamed NotebookLM to "Gemini Notebook" and moved the app from
 * `notebooklm.google.com` to `notebook.google.com`. Both hosts are still
 * served and a completed login can land on either one, so every URL check
 * must accept both. Centralised here so the set of valid hosts is defined
 * exactly once instead of being duplicated across call sites.
 */

export const NOTEBOOK_APP_HOSTS = ["notebooklm.google.com", "notebook.google.com"] as const;

/**
 * True when the URL points at the NotebookLM/Gemini Notebook app itself
 * (i.e. login has completed and we are no longer on accounts.google.com).
 */
export function isNotebookAppUrl(url: string): boolean {
  return NOTEBOOK_APP_HOSTS.some((host) => url.startsWith(`https://${host}/`));
}

/**
 * Looser variant: the URL mentions one of the app hosts anywhere. Use when
 * the URL may still carry a redirect wrapper rather than being the final
 * destination.
 */
export function mentionsNotebookHost(url: string): boolean {
  return NOTEBOOK_APP_HOSTS.some((host) => url.includes(host));
}
