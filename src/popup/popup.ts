// The popup: shows what the service worker answers and sends back the
// person's choice. It never sees a password.

import { MIN_APP_VERSION } from "../background/protocol";
import { api } from "../shared/api";
import {
  queryTooShort,
  type FillResult,
  type LoginSummary,
  type PopupRequest,
  type SearchResult,
  type ShowResult,
  type View,
} from "../shared/messages";
import { sameSite } from "../shared/site";

const root = document.getElementById("app") as HTMLElement;
let tabId = -1;
let site = "";
// The origin the list on screen was built for. A fill goes there or nowhere.
let listOrigin = "";
let silo: string | undefined;

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
  root.replaceChildren(...children);
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

function somethingWrong(body = "Close this and try again."): void {
  show(header(), message("Something went wrong", body, "warn"));
}

const STATE_TEXT: Record<string, [string, string]> = {
  "no-host": [
    "SilentSilo is not installed",
    `SilentSilo ${MIN_APP_VERSION} or later needs to be installed on this computer. If it already is, run its installer again.`,
  ],
  "app-not-running": [
    "SilentSilo is not reachable",
    "Start the SilentSilo desktop app and turn on Settings > Browser extension there, then try again.",
  ],
  locked: ["Your silo is locked", "Unlock it in SilentSilo, then try again."],
  "no-silo": ["No silo yet", "Create a silo in SilentSilo, or set one up from backup storage."],
  "unsupported-page": [
    "This page cannot be filled",
    "SilentSilo fills https pages, and http pages on this computer only.",
  ],
};

function render(view: View): void {
  if (view.state === "ready") {
    renderReady(view);
    return;
  }
  if (view.state === "update") {
    // Only a plain version number is echoed back; anything else is left out.
    const current = /^v?\d{1,4}\.\d{1,4}\.\d{1,4}(-[0-9A-Za-z.]{1,20})?$/.test(view.version)
      ? `SilentSilo ${view.version} is installed. `
      : "";
    show(header(), message("Update SilentSilo", `${current}This extension needs version ${view.required} or later.`, "warn"));
    return;
  }
  if (view.state === "error") {
    // view.message is always one of the extension's own texts (TEXT in
    // service.ts), never words from the app.
    show(header(), message("SilentSilo could not list your logins", view.message, "warn"));
    return;
  }
  const [title, body] = STATE_TEXT[view.state];
  const parts: Node[] = [header(), message(title, body, view.state === "unsupported-page" ? "plain" : "warn")];
  if (view.state === "locked" || view.state === "no-silo") parts.push(openApp(view.state));
  show(...parts);
}

const AFTER_SHOW: Record<"locked" | "no-silo", string> = {
  locked: "Unlock your silo in the SilentSilo window, then click the extension again.",
  "no-silo":
    "Create a silo in the SilentSilo window, or set one up from backup storage, then click the extension again.",
};

// Brings the app's window forward. The popup may close as it takes focus.
function openApp(state: "locked" | "no-silo"): HTMLElement {
  const box = el("div", "open-app");
  const button = el("button", "action", "Open SilentSilo");
  button.type = "button";
  const note = el("p", "hint");
  note.setAttribute("role", "status");
  button.addEventListener("click", async () => {
    button.disabled = true;
    const answer = await ask<ShowResult>({ kind: "show" });
    button.disabled = false;
    if (!answer) {
      note.textContent = "Something went wrong. Close this and try again.";
      return;
    }
    if (answer.state === "shown") {
      note.textContent = AFTER_SHOW[state];
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
  if (view.waiting) {
    renderWaiting();
    return;
  }
  const parts: Node[] = [header(view.silo), siteLine()];
  if (view.notice) parts.push(banner(view.notice));
  if (view.logins.length > 0) {
    parts.push(loginList(view.logins));
    const more = el("button", "link", "Search all logins");
    more.type = "button";
    more.addEventListener("click", () => renderSearch(view.silo, view.notice));
    parts.push(more);
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
    message(
      "Nothing saved for this site",
      `Nothing is saved for ${site}. If you expected a login here, check the address: this may not be the site you think.`,
      "warn",
    ),
  );
  const anyway = el("button", "link", "Search anyway");
  anyway.type = "button";
  anyway.addEventListener("click", () => renderSearch(silo, notice));
  parts.push(anyway);
  show(...parts);
}

function siteLine(): HTMLElement {
  const line = el("p", "site");
  line.append(el("span", "muted", "Logins for "), el("strong", "", site));
  return line;
}

function savedFor(login: LoginSummary): HTMLElement {
  if (login.site === undefined) return el("span", "saved other", "Saved for an unknown site");
  if (!login.site) return el("span", "saved other", "Saved without a site");
  return el("span", sameSite(login.site, site) ? "saved" : "saved other", `Saved for ${login.site}`);
}

function loginList(logins: LoginSummary[], showSite = false): HTMLElement {
  const list = el("ul", "logins");
  for (const login of logins) {
    const item = el("li");
    const button = el("button", "login");
    button.type = "button";
    button.append(el("span", "label", login.label || "Untitled login"));
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
  input.placeholder = "Search all logins";
  input.setAttribute("aria-label", "Search all logins");
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
        results.replaceChildren(el("p", "muted", "Type at least two characters"));
        return;
      }
      const answer = await ask<SearchResult>({ kind: "search", tabId, query });
      if (mine !== latest) return;
      if (!answer) {
        results.replaceChildren(el("p", "muted", "Something went wrong. Try again."));
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
        results.replaceChildren(el("p", "muted", "Nothing matches."));
        return;
      }
      results.replaceChildren(
        loginList(answer.logins, true),
        el("p", "hint", "A login found by search may belong to another site. SilentSilo says so when you confirm."),
      );
    }, 250);
  });
}

function renderWaiting(): void {
  const box = message("Confirm in SilentSilo", `The desktop app is asking you to confirm this fill on ${site}.`);
  box.classList.add("waiting");
  show(header(silo), box);
}

async function fill(ref: string): Promise<void> {
  renderWaiting();
  const result = await ask<FillResult>({ kind: "fill", tabId, ref, origin: listOrigin });
  await ask({ kind: "seen", tabId });
  if (!result) {
    somethingWrong("Nothing was filled. Close this and try again.");
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
    show(header(silo), message("Nothing was filled", result.message, "warn"));
    return;
  }
  if (view.state === "ready") renderReady({ ...view, notice: result.message });
  else render(view);
}

async function start(): Promise<void> {
  show(header(), el("p", "muted loading", "Asking SilentSilo…"));
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
