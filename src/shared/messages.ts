// What the popup and the service worker say to each other. Nothing secret
// crosses here: labels and usernames on the way to the popup, a ref on the
// way back. The password goes from the service worker to the page only.

import type { LoginSummary } from "../background/protocol";

export type { LoginSummary };

// The app finds nothing for a shorter search, so none is sent. Counted in
// characters after trimming, as the app counts them.
export const MIN_QUERY_CHARS = 2;

export function queryTooShort(query: string): boolean {
  return [...query.trim()].length < MIN_QUERY_CHARS;
}

export type PopupRequest =
  | { kind: "open"; tabId: number }
  | { kind: "search"; tabId: number; query: string }
  | { kind: "fill"; tabId: number; ref: string }
  // The popup showed how the fill ended, so nothing needs to wait for it.
  | { kind: "seen"; tabId: number };

export type View =
  | { state: "no-host" }
  | { state: "app-not-running" }
  | { state: "locked" }
  | { state: "no-silo" }
  | { state: "update"; version: string; required: string }
  | { state: "unsupported-page" }
  | { state: "error"; message: string }
  | {
      state: "ready";
      site: string;
      silo?: string;
      logins: LoginSummary[];
      // A fill for this tab is waiting for confirmation in the app.
      waiting: boolean;
      // How the last fill on this tab ended, when the popup was closed then.
      notice?: string;
    };

export type SearchResult = { state: "results"; logins: LoginSummary[] } | Exclude<View, { state: "ready" }>;

export type FillResult =
  | { ok: true; usernameFilled: boolean }
  | { ok: false; message: string; view?: View };
