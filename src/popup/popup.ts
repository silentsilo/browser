// The popup: shows what the service worker answers and sends back the
// person's choice. It never sees a password.

import { MIN_APP_VERSION } from "../background/protocol";
import { api } from "../shared/api";
import { msg, uiLanguage, type MessageKey } from "../shared/i18n";
import {
  queryTooShort,
  type FillResult,
  type LoginSummary,
  type PopupRequest,
  type SaveResult,
  type SearchResult,
  type ShowResult,
  type View,
} from "../shared/messages";
import { sameSite } from "../shared/site";

const root = document.getElementById("app") as HTMLElement;
document.documentElement.lang = uiLanguage();
let tabId = -1;
let site = "";
// The origin the list on screen was built for. A fill goes there or nowhere.
let listOrigin = "";
let silo: string | undefined;
// The app saves logins from the page (1.4.0 and later).
let canSave = false;
// Bumped by every new screen, so a recheck started for an old one does nothing.
let screen = 0;
let recheck: ReturnType<typeof setTimeout> | undefined;

// How often a screen waiting on the app asks again.
const RECHECK_MS = 2000;

// Undefined when the background script could not answer, as when it stopped
// between two messages.
async function ask<T>(request: PopupRequest): Promise<T | undefined> {
  try {
    return (await api.runtime.sendMessage(request)) as T | undefined;
  } catch {
    return undefined;
  }
}

function el<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  className?: string,
  text?: string,
): HTMLElementTagNameMap[K] {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function header(silo?: string): HTMLElement {
  const bar = el("header", "bar");
  const logo = el("img", "logo");
  logo.src = "icons/icon-32.png";
  logo.alt = "";
  bar.append(logo, el("span", "name", "SilentSilo"));
  if (silo) bar.append(el("span", "silo", silo));
  return bar;
}

function show(...children: Node[]): void {
  screen++;
  clearTimeout(recheck);
  root.replaceChildren(...children);
}

// The app not running, the silo locked, no silo yet: the popup asks again
// every few seconds and moves on by itself when the answer changes.
type Waiting = "app-not-running" | "locked" | "no-silo";

const WAITING_FOR: Record<Waiting, MessageKey> = {
  "app-not-running": "popup_waiting_start",
  locked: "popup_waiting_unlock",
  "no-silo": "popup_waiting_silo",
};

function askAgain(state: Waiting): void {
  const mine = screen;
  recheck = setTimeout(async () => {
    if (mine !== screen || !root.isConnected) return;
    const view = await ask<View>({ kind: "open", tabId });
    if (mine !== screen) return;
    // Only the same answer, or none, is waited out. An error is shown: taken
    // as "still waiting", a silo that failed to read after its unlock stayed
    // on "locked" while every try read it again.
    if (!view || view.state === state) askAgain(state);
    else render(view);
  }, RECHECK_MS);
}

function message(title: string, body: string, tone: "plain" | "warn" = "plain"): HTMLElement {
  const box = el("section", `message ${tone}`);
  box.append(el("h1", "", title), el("p", "", body));
  return box;
}

function banner(text: string): HTMLElement {
  const box = el("p", "banner", text);
  box.setAttribute("role", "alert");
  return box;
}

function somethingWrong(body = msg("popup_error_body")): void {
  show(header(), message(msg("popup_error_title"), body, "warn"));
}

function stateText(state: "no-host" | Waiting | "unsupported-page"): [string, string] {
  switch (state) {
    case "no-host":
      return [msg("popup_no_host_title"), msg("popup_no_host_body", { version: MIN_APP_VERSION })];
    case "app-not-running":
      return [msg("popup_not_reachable_title"), msg("popup_not_reachable_body")];
    case "locked":
      return [msg("popup_locked_title"), msg("popup_locked_body")];
    case "no-silo":
      return [msg("popup_no_silo_title"), msg("popup_no_silo_body")];
    case "unsupported-page":
      return [msg("popup_unsupported_title"), msg("popup_unsupported_body")];
  }
}

function render(view: View): void {
  if (view.state === "ready") {
    renderReady(view);
    return;
  }
  if (view.state === "update") {
    // Only a plain version number is echoed back; anything else is left out.
    const body = /^v?\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/.test(view.version)
      ? msg("popup_update_body_installed", { installed: view.version, required: view.required })
      : msg("popup_update_body", { required: view.required });
    show(header(), message(msg("popup_update_title"), body, "warn"));
    return;
  }
  if (view.state === "error") {
    // view.message is always one of the extension's own texts (TEXT in
    // service.ts), never words from the app.
    show(header(), message(msg("popup_list_error_title"), view.message, "warn"));
    return;
  }
  const [title, body] = stateText(view.state);
  const parts: Node[] = [header(), message(title, body, view.state === "unsupported-page" ? "plain" : "warn")];
  if (view.state === "locked" || view.state === "no-silo") parts.push(openApp(view.state));
  if (view.state === "app-not-running" || view.state === "locked" || view.state === "no-silo") {
    parts.push(el("p", "hint rechecking", msg(WAITING_FOR[view.state])));
    show(...parts);
    askAgain(view.state);
    return;
  }
  show(...parts);
}

// The popup may close as the window takes focus; if it stays open, it moves
// on by itself.
const AFTER_SHOW: Record<"locked" | "no-silo", MessageKey> = {
  locked: "popup_after_open_locked",
  "no-silo": "popup_after_open_no_silo",
};

// Brings the app's window forward. The popup may close as it takes focus.
function openApp(state: "locked" | "no-silo"): HTMLElement {
  const box = el("div", "open-app");
  const button = el("button", "action", msg("popup_open_app"));
  button.type = "button";
  const note = el("p", "hint");
  note.setAttribute("role", "status");
  button.addEventListener("click", async () => {
    button.disabled = true;
    const answer = await ask<ShowResult>({ kind: "show" });
    button.disabled = false;
    if (!answer) {
      note.textContent = msg("popup_error_retry_close");
      return;
    }
    if (answer.state === "shown") {
      note.textContent = msg(AFTER_SHOW[state]);
      return;
    }
    // Busy and the like stay under the button; anything else is a new state.
    if (answer.state === "error") {
      note.textContent = answer.message;
      return;
    }
    render(answer);
  });
  box.append(button, note);
  return box;
}

function renderReady(view: Extract<View, { state: "ready" }>): void {
  site = view.site;
  listOrigin = view.origin;
  silo = view.silo;
  canSave = view.canSave;
  if (view.waiting) {
    renderWaiting(view.waiting);
    return;
  }
  const parts: Node[] = [header(view.silo), siteLine()];
  if (view.notice) parts.push(banner(view.notice));
  if (view.logins.length > 0) {
    parts.push(loginList(view.logins));
    const more = el("button", "link", msg("popup_search_all"));
    more.type = "button";
    more.addEventListener("click", () => renderSearch(view.silo, view.notice));
    parts.push(more);
    if (canSave) parts.push(saveButton());
    show(...parts);
  } else {
    renderNoMatch(view.silo, view.notice);
  }
}

// Nothing is saved for this site. A phishing page can say "search for
// paypal", so the search box is not offered straight away: first a warning,
// then a deliberate click, and nothing has focus until then.
function renderNoMatch(silo: string | undefined, notice?: string): void {
  const parts: Node[] = [header(silo), siteLine()];
  if (notice) parts.push(banner(notice));
  parts.push(
    message(msg("popup_no_match_title"), msg("popup_no_match_body", { site }), "warn"),
  );
  const anyway = el("button", "link", msg("popup_search_anyway"));
  anyway.type = "button";
  anyway.addEventListener("click", () => renderSearch(silo, notice));
  parts.push(anyway);
  if (canSave) parts.push(saveButton());
  show(...parts);
}

// What the person typed on the page, offered to the app, which asks them.
// The popup never sees the password: the service worker reads it from the
// page and sends it on.
function saveButton(): HTMLElement {
  const box = el("div", "save");
  const button = el("button", "link", msg("popup_save_button"));
  button.type = "button";
  button.addEventListener("click", () => void save());
  box.append(button, el("p", "hint", msg("popup_save_hint")));
  return box;
}

async function save(): Promise<void> {
  renderWaiting("save");
  const result = await ask<SaveResult>({ kind: "save", tabId, origin: listOrigin });
  await ask({ kind: "seen", tabId });
  if (!result) {
    somethingWrong(msg("popup_save_lost"));
    return;
  }
  if (result.ok) {
    show(
      header(silo),
      result.updated
        ? message(msg("popup_updated_title"), msg("popup_updated_body", { site }))
        : message(msg("popup_saved_title"), msg("popup_saved_body", { site })),
    );
    return;
  }
  if (result.view && result.view.state !== "error") {
    render(result.view);
    return;
  }
  show(header(silo), message(msg("popup_not_saved_title"), result.message, "warn"));
}

// "Logins for <site>", the site in bold wherever the language puts it.
function siteLine(): HTMLElement {
  const line = el("p", "site");
  const mark = "\uE000";
  const [before, after = ""] = msg("popup_logins_for", { site: mark }).split(mark);
  if (before) line.append(el("span", "muted", before));
  line.append(el("strong", "", site));
  if (after) line.append(el("span", "muted", after));
  return line;
}

function savedFor(login: LoginSummary): HTMLElement {
  if (login.site === undefined) return el("span", "saved other", msg("popup_saved_unknown_site"));
  if (!login.site) return el("span", "saved other", msg("popup_saved_no_site"));
  const own = sameSite(login.site, site);
  return el("span", own ? "saved" : "saved other", msg("popup_saved_for", { site: login.site }));
}

function loginList(logins: LoginSummary[], showSite = false): HTMLElement {
  const list = el("ul", "logins");
  for (const login of logins) {
    const item = el("li");
    const button = el("button", "login");
    button.type = "button";
    button.append(el("span", "label", login.label || msg("popup_untitled")));
    if (login.username) button.append(el("span", "user", login.username));
    if (showSite) button.append(savedFor(login));
    button.addEventListener("click", () => void fill(login.ref));
    item.append(button);
    list.append(item);
  }
  return list;
}

// Reached only by a click on "Search anyway" or "Search all logins".
function renderSearch(silo: string | undefined, notice?: string): void {
  const parts: Node[] = [header(silo), siteLine()];
  if (notice) parts.push(banner(notice));

  const input = el("input", "search");
  input.type = "search";
  input.placeholder = msg("popup_search_placeholder");
  input.setAttribute("aria-label", input.placeholder);
  input.maxLength = 200;
  input.autocomplete = "off";
  input.spellcheck = false;

  const results = el("div", "results");
  results.setAttribute("aria-live", "polite");
  parts.push(input, results);
  show(...parts);
  input.focus();

  let timer: ReturnType<typeof setTimeout> | undefined;
  let latest = 0;
  input.addEventListener("input", () => {
    clearTimeout(timer);
    timer = setTimeout(async () => {
      const query = input.value.trim();
      const mine = ++latest;
      if (!query) {
        results.replaceChildren();
        return;
      }
      if (queryTooShort(query)) {
        results.replaceChildren(el("p", "muted", msg("popup_query_too_short")));
        return;
      }
      const answer = await ask<SearchResult>({ kind: "search", tabId, query });
      if (mine !== latest) return;
      if (!answer) {
        results.replaceChildren(el("p", "muted", msg("popup_search_failed")));
        return;
      }
      // A refusal the person can wait out (busy) stays under the search box.
      if (answer.state === "error") {
        results.replaceChildren(el("p", "muted", answer.message));
        return;
      }
      if (answer.state !== "results") {
        render(answer);
        return;
      }
      if (answer.logins.length === 0) {
        results.replaceChildren(el("p", "muted", msg("popup_no_results")));
        return;
      }
      results.replaceChildren(
        loginList(answer.logins, true),
        el("p", "hint", msg("popup_search_hint")),
      );
    }, 250);
  });
}

function renderWaiting(what: "fill" | "save"): void {
  const box = message(
    msg("popup_confirm_title"),
    what === "fill" ? msg("popup_confirm_fill", { site }) : msg("popup_confirm_save", { site }),
  );
  box.classList.add("waiting");
  show(header(silo), box);
}

async function fill(ref: string): Promise<void> {
  renderWaiting("fill");
  const result = await ask<FillResult>({ kind: "fill", tabId, ref, origin: listOrigin });
  await ask({ kind: "seen", tabId });
  if (!result) {
    somethingWrong(msg("popup_fill_lost"));
    return;
  }
  if (result.ok) {
    window.close();
    return;
  }
  if (result.view && result.view.state !== "error") {
    render(result.view);
    return;
  }
  const view = await ask<View>({ kind: "open", tabId });
  if (!view) {
    show(header(silo), message(msg("popup_fill_failed_title"), result.message, "warn"));
    return;
  }
  if (view.state === "ready") renderReady({ ...view, notice: result.message });
  else render(view);
}

async function start(): Promise<void> {
  show(header(), el("p", "muted loading", msg("popup_asking")));
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    render({ state: "unsupported-page" });
    return;
  }
  tabId = tab.id;
  const view = await ask<View>({ kind: "open", tabId });
  if (view) render(view);
  else somethingWrong();
}

start().catch(() => somethingWrong());
