// The popup: shows what the service worker answers and sends back the
// person's choice. It never sees a password.

import type { FillResult, LoginSummary, PopupRequest, SearchResult, View } from "../shared/messages";

const root = document.getElementById("app") as HTMLElement;
let tabId = -1;
let site = "";
let silo: string | undefined;

function ask<T>(request: PopupRequest): Promise<T> {
  return chrome.runtime.sendMessage(request) as Promise<T>;
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

const STATE_TEXT: Record<string, [string, string]> = {
  "no-host": [
    "SilentSilo is not installed",
    "The desktop app, version 1.2.0 or later, needs to be installed on this computer.",
  ],
  "app-not-running": ["SilentSilo is not running", "Start the desktop app and unlock your silo, then try again."],
  locked: ["Your silo is locked", "Unlock it in SilentSilo, then try again."],
  "no-silo": ["No silo yet", "Create or open a silo in the SilentSilo desktop app."],
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
    const current = view.version ? `SilentSilo ${view.version} is installed. ` : "";
    show(header(), message("Update SilentSilo", `${current}This extension needs version ${view.required} or later.`, "warn"));
    return;
  }
  if (view.state === "error") {
    show(header(), message("Could not reach your logins", view.message, "warn"));
    return;
  }
  const [title, body] = STATE_TEXT[view.state];
  show(header(), message(title, body, view.state === "unsupported-page" ? "plain" : "warn"));
}

function renderReady(view: Extract<View, { state: "ready" }>): void {
  site = view.site;
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
    renderSearch(view.silo, view.notice, `No logins saved for ${view.site}.`);
  }
}

function siteLine(): HTMLElement {
  const line = el("p", "site");
  line.append(el("span", "muted", "Logins for "), el("strong", "", site));
  return line;
}

function loginList(logins: LoginSummary[]): HTMLElement {
  const list = el("ul", "logins");
  for (const login of logins) {
    const item = el("li");
    const button = el("button", "login");
    button.type = "button";
    button.append(el("span", "label", login.label || "(no name)"));
    if (login.username) button.append(el("span", "user", login.username));
    button.addEventListener("click", () => fill(login.ref));
    item.append(button);
    list.append(item);
  }
  return list;
}

function renderSearch(silo: string | undefined, notice?: string, empty?: string): void {
  const parts: Node[] = [header(silo), siteLine()];
  if (notice) parts.push(banner(notice));
  if (empty) parts.push(el("p", "muted", empty));

  const input = el("input", "search");
  input.type = "search";
  input.placeholder = "Search all logins";
  input.setAttribute("aria-label", "Search all logins");
  input.maxLength = 200;
  input.autocomplete = "off";
  input.spellcheck = false;

  const results = el("div", "results");
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
      const answer = await ask<SearchResult>({ kind: "search", tabId, query });
      if (mine !== latest) return;
      if (answer.state !== "results") {
        render(answer);
        return;
      }
      if (answer.logins.length === 0) {
        results.replaceChildren(el("p", "muted", "Nothing matches."));
        return;
      }
      results.replaceChildren(
        loginList(answer.logins),
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
  const result = await ask<FillResult>({ kind: "fill", tabId, ref });
  await ask({ kind: "seen", tabId });
  if (!result) {
    show(header(), message("Something went wrong", "Nothing was filled.", "warn"));
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
  if (view.state === "ready") renderReady({ ...view, notice: result.message });
  else render(view);
}

async function start(): Promise<void> {
  show(header(), el("p", "muted loading", "Asking SilentSilo..."));
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (tab?.id === undefined) {
    render({ state: "unsupported-page" });
    return;
  }
  tabId = tab.id;
  render(await ask<View>({ kind: "open", tabId }));
}

start().catch(() => show(header(), message("Something went wrong", "Close this and try again.", "warn")));
