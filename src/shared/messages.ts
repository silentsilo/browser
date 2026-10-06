// What the popup and the service worker say to each other. Nothing secret
// crosses here: labels and usernames on the way to the popup, a ref on the
// way back. A password goes from the service worker to the page for a fill,
// and from the page to the service worker for a save, never to the popup.

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
  // `origin` is the one the list was built for; the fill goes there or nowhere.
  | { kind: "fill"; tabId: number; ref: string; origin: string }
  // "Open SilentSilo": the app's window to the front, to unlock there.
  | { kind: "show" }
  // The popup showed how the fill ended, so nothing needs to wait for it.
  | { kind: "seen"; tabId: number }
  // "Save this login": what is typed on the page, offered to the app.
  | { kind: "save"; tabId: number; origin: string };

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
      // The tab's origin when the list was built, and its host as shown.
      origin: string;
      site: string;
      silo?: string;
      logins: LoginSummary[];
      // A fill or a save for this tab is waiting for confirmation in the app.
      waiting: "fill" | "save" | null;
      // How the last fill on this tab ended, when the popup was closed then.
      notice?: string;
      // The app is recent enough to save a login from the page.
      canSave: boolean;
    };

export type SearchResult = { state: "results"; logins: LoginSummary[] } | Exclude<View, { state: "ready" }>;

export type ShowResult = { state: "shown" } | Exclude<View, { state: "ready" }>;

export type SaveResult = { ok: true; updated: boolean } | { ok: false; message: string; view?: View };

export type FillResult =
  | { ok: true; usernameFilled: boolean }
  | { ok: false; message: string; view?: View };
