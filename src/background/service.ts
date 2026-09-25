import { queryTooShort, type FillResult, type SearchResult, type ShowResult, type View } from "../shared/messages";
import type { FillArgs, FillResult as PageResult } from "../page/fill-page";
import { ClientError, type NativeClient } from "./native-client";
import { fillableOrigin, siteName } from "./origin";
import { MIN_APP_VERSION, type LoginSummary } from "./protocol";
import { isAtLeast } from "./version";

export const QUICK_TIMEOUT_MS = 10_000;
// The app's own prompt times out first and answers `cancelled`; this is the
// backstop for an app that never answers at all.
export const FILL_TIMEOUT_MS = 5 * 60_000;
export const MAX_QUERY_LENGTH = 200;

export interface ServiceDeps {
  client: Pick<NativeClient, "request">;
  // The tab's address as the browser reports it, never as the page says.
  tabUrl: (tabId: number) => Promise<string | undefined>;
  runInPage: (tabId: number, args: FillArgs) => Promise<PageResult | undefined>;
  // Marks the toolbar button when a fill failed with the popup closed.
  flag: (tabId: number, on: boolean) => void;
}

export const TEXT = {
  timeout: "SilentSilo did not answer in time.",
  badAnswer: "SilentSilo sent an answer this extension does not understand. Update both to the latest version.",
  noPassword: "No password field on this page. Open the login form, then try again.",
  crossOriginFrame:
    "The login form is inside a frame from another site. This version fills only the main page.",
  sameOriginFrame: "The login form is inside a frame on this page. This version fills only the main page.",
  navigated: "The page changed before the fill. Nothing was filled.",
  // A form planted on the site to send the password somewhere else.
  elsewhere: (host: string) =>
    host
      ? `The login form on this page sends what you type to ${host}, not to this site. Nothing was filled.`
      : "The login form on this page sends what you type somewhere other than this site. Nothing was filled.",
  cannotReach: "This page cannot be filled.",
  generic: "Something went wrong. Nothing was filled.",
  // One per error code the app sends. The app's own `message` is never shown.
  unknownRef: "This list was out of date, so nothing was filled. Choose the login again.",
  cancelled: "The fill was not confirmed in SilentSilo. Nothing was filled.",
  // Another fill waiting, too many requests, or the pause after a declined fill.
  busy: "SilentSilo is busy. Try again in a few seconds.",
  noAuthenticator:
    "This silo has no security key or Windows Hello set up, so SilentSilo cannot confirm a fill. Add one under Unlocking in SilentSilo, then try again.",
  badRequest: "SilentSilo refused the request. If this keeps happening, update SilentSilo and this extension.",
  readFailed: "SilentSilo could not read the logins in this silo. Try again, or restart SilentSilo.",
  unknownCode: "SilentSilo refused the request for a reason this extension does not know. Update both to the latest version.",
  alreadyWaiting: "A fill is already waiting for confirmation.",
  otherTabWaiting:
    "A fill on another tab is waiting for confirmation in SilentSilo. Confirm or cancel it there, then try again.",
};

export class Service {
  // Tabs with a fill waiting for confirmation in the app.
  private waiting = new Set<number>();
  // How a fill ended when the popup may have been closed, and the origin it
  // was for. Never a secret.
  private notices = new Map<number, { origin: string; message: string }>();

  constructor(private readonly deps: ServiceDeps) {}

  async open(tabId: number): Promise<View> {
    const saved = this.notices.get(tabId);
    this.notices.delete(tabId);
    this.deps.flag(tabId, false);

    const origin = fillableOrigin(await this.deps.tabUrl(tabId));
    if (!origin) return { state: "unsupported-page" };
    // Shown only on the site it was about.
    const notice = saved?.origin === origin ? saved.message : undefined;
    try {
      const status = await this.deps.client.request({ type: "status" }, QUICK_TIMEOUT_MS);
      const version = typeof status.version === "string" ? status.version : "";
      if (!isAtLeast(version, MIN_APP_VERSION)) {
        return { state: "update", version, required: MIN_APP_VERSION };
      }
      if (status.state === "locked") return { state: "locked" };
      if (status.state === "no-silo") return { state: "no-silo" };
      if (status.state !== "unlocked") return { state: "error", message: TEXT.badAnswer };

      const answer = await this.deps.client.request({ type: "logins", origin }, QUICK_TIMEOUT_MS);
      const logins = readLogins(answer.logins);
      if (!logins) return { state: "error", message: TEXT.badAnswer };
      return {
        state: "ready",
        origin,
        site: siteName(origin),
        silo: typeof status.silo === "string" ? status.silo : undefined,
        logins,
        waiting: this.waiting.has(tabId),
        notice,
      };
    } catch (error) {
      return errorView(error);
    }
  }

  async search(query: string): Promise<SearchResult> {
    const trimmed = query.trim().slice(0, MAX_QUERY_LENGTH);
    if (queryTooShort(trimmed)) return { state: "results", logins: [] };
    try {
      const answer = await this.deps.client.request({ type: "search", query: trimmed }, QUICK_TIMEOUT_MS);
      const logins = readLogins(answer.logins);
      if (!logins) return { state: "error", message: TEXT.badAnswer };
      return { state: "results", logins: logins.slice(0, 20) };
    } catch (error) {
      return errorView(error);
    }
  }

  // Asks the app to bring its window forward. The unlock happens there, and
  // nothing continues here afterwards.
  async show(): Promise<ShowResult> {
    try {
      await this.deps.client.request({ type: "show" }, QUICK_TIMEOUT_MS);
      return { state: "shown" };
    } catch (error) {
      return errorView(error);
    }
  }

  // `listed` is the origin the popup's list was built for.
  async fill(tabId: number, ref: string, listed: string): Promise<FillResult> {
    const result = await this.fillOnce(tabId, ref, listed);
    if (!result.ok) {
      this.notices.set(tabId, { origin: listed, message: result.message });
      this.deps.flag(tabId, true);
    }
    return result;
  }

  // Called when the popup that asked for the fill got its answer.
  seen(tabId: number): void {
    this.notices.delete(tabId);
    this.deps.flag(tabId, false);
  }

  // The tab closed: nothing about it is kept.
  forget(tabId: number): void {
    this.notices.delete(tabId);
  }

  private async fillOnce(tabId: number, ref: string, listed: string): Promise<FillResult> {
    const origin = fillableOrigin(await this.deps.tabUrl(tabId));
    if (!origin) return { ok: false, message: TEXT.cannotReach };
    // The fill goes where the list was made for, or nowhere.
    if (origin !== listed) return { ok: false, message: TEXT.navigated };

    // Look for the fields before asking the app, so nobody confirms a fill
    // that has nowhere to go.
    const probe = await this.inPage(tabId, { expectedOrigin: origin, fill: null });
    if (probe.outcome !== "ready") return pageFailure(probe);

    if (this.waiting.has(tabId)) return { ok: false, message: TEXT.alreadyWaiting };
    // The app would answer busy; this says why.
    if (this.waiting.size > 0) return { ok: false, message: TEXT.otherTabWaiting };
    this.waiting.add(tabId);
    let answer: Record<string, unknown>;
    try {
      answer = await this.deps.client.request({ type: "fill", origin, ref }, FILL_TIMEOUT_MS);
    } catch (error) {
      const view = errorView(error);
      return { ok: false, message: view.state === "error" ? view.message : fillStopped(view.state), view };
    } finally {
      this.waiting.delete(tabId);
    }

    if (typeof answer.username !== "string" || typeof answer.password !== "string") {
      return { ok: false, message: TEXT.badAnswer };
    }
    const fill = { username: answer.username, password: answer.password };
    answer.username = answer.password = "";
    // The page function checks the origin again: the tab may have moved on
    // while the person was confirming.
    const done = await this.inPage(tabId, { expectedOrigin: origin, fill });
    fill.username = fill.password = "";
    if (done.outcome !== "filled") return pageFailure(done);
    return { ok: true, usernameFilled: done.usernameFilled };
  }

  private async inPage(tabId: number, args: FillArgs): Promise<PageResult | { outcome: "unreachable" }> {
    try {
      return (await this.deps.runInPage(tabId, args)) ?? { outcome: "unreachable" };
    } catch {
      return { outcome: "unreachable" };
    }
  }
}

function fillStopped(state: View["state"]): string {
  if (state === "locked") return "Your silo is locked. Nothing was filled.";
  if (state === "app-not-running") return "SilentSilo is not reachable. Nothing was filled.";
  return TEXT.generic;
}

function pageFailure(result: PageResult | { outcome: "unreachable" }): FillResult {
  switch (result.outcome) {
    case "no-password":
      if (result.frame === "this-site") return { ok: false, message: TEXT.sameOriginFrame };
      if (result.frame === "other-site") return { ok: false, message: TEXT.crossOriginFrame };
      return { ok: false, message: TEXT.noPassword };
    case "wrong-origin":
      return { ok: false, message: TEXT.navigated };
    case "elsewhere":
      return { ok: false, message: TEXT.elsewhere(result.host) };
    case "unreachable":
      return { ok: false, message: TEXT.cannotReach };
    default:
      return { ok: false, message: TEXT.generic };
  }
}

function readLogins(value: unknown): LoginSummary[] | null {
  if (!Array.isArray(value)) return null;
  const logins: LoginSummary[] = [];
  for (const item of value) {
    if (typeof item !== "object" || item === null) return null;
    const { ref, label, username, site } = item as Record<string, unknown>;
    if (typeof ref !== "string" || typeof label !== "string") return null;
    const login: LoginSummary = { ref, label, username: typeof username === "string" ? username : "" };
    if (typeof site === "string") login.site = site;
    logins.push(login);
  }
  return logins;
}

export function errorView(error: unknown): Exclude<View, { state: "ready" }> {
  if (!(error instanceof ClientError)) return { state: "error", message: TEXT.generic };
  switch (error.code) {
    case "no-host":
      return { state: "no-host" };
    case "app-not-running":
      return { state: "app-not-running" };
    case "locked":
      return { state: "locked" };
    case "no-silo":
      return { state: "no-silo" };
    case "timeout":
      return { state: "error", message: TEXT.timeout };
    case "bad-answer":
      return { state: "error", message: TEXT.badAnswer };
    case "unknown-ref":
      return { state: "error", message: TEXT.unknownRef };
    case "cancelled":
      return { state: "error", message: TEXT.cancelled };
    case "busy":
      return { state: "error", message: TEXT.busy };
    case "no-authenticator":
      return { state: "error", message: TEXT.noAuthenticator };
    case "bad-request":
      return { state: "error", message: TEXT.badRequest };
    case "read-failed":
      return { state: "error", message: TEXT.readFailed };
    default:
      return { state: "error", message: TEXT.unknownCode };
  }
}
