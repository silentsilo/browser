import {
  queryTooShort,
  type FillResult,
  type SaveResult,
  type SearchResult,
  type ShowResult,
  type View,
} from "../shared/messages";
import type { FillArgs, FillResult as PageResult } from "../page/fill-page";
import { msg } from "../shared/i18n";
import { ClientError, type NativeClient } from "./native-client";
import { fillableOrigin, siteName } from "./origin";
import { MIN_APP_VERSION, SAVE_APP_VERSION, type LoginSummary } from "./protocol";
import { isAtLeast } from "./version";

export const QUICK_TIMEOUT_MS = 10_000;
// The app's own prompt times out first and answers `cancelled`; this is the
// backstop for an app that never answers at all.
export const FILL_TIMEOUT_MS = 5 * 60_000;
export const MAX_QUERY_LENGTH = 200;
// The app waits 120 seconds for the person; this is the backstop.
export const SAVE_TIMEOUT_MS = 3 * 60_000;
// What the app takes in a save.
export const MAX_SAVE_FIELD = 1024;

export interface ServiceDeps {
  client: Pick<NativeClient, "request">;
  // The tab's address as the browser reports it, never as the page says.
  tabUrl: (tabId: number) => Promise<string | undefined>;
  runInPage: (tabId: number, args: FillArgs) => Promise<PageResult | undefined>;
  // Marks the toolbar button when a fill failed with the popup closed.
  flag: (tabId: number, on: boolean) => void;
}

// The extension's own texts for every outcome. The app's words never reach
// the popup.
export const TEXT = {
  timeout: msg("err_timeout"),
  badAnswer: msg("err_bad_answer"),
  noPassword: msg("err_no_password_field"),
  crossOriginFrame: msg("err_frame_other_site"),
  sameOriginFrame: msg("err_frame_this_site"),
  navigated: msg("err_navigated_fill"),
  // A form planted on the site to send the password somewhere else.
  elsewhere: (host: string) => (host ? msg("err_form_elsewhere_host", { host }) : msg("err_form_elsewhere")),
  cannotReach: msg("err_cannot_fill"),
  generic: msg("err_generic_fill"),
  // One per error code the app sends. The app's own `message` is never shown.
  unknownRef: msg("err_unknown_ref"),
  cancelled: msg("err_fill_cancelled"),
  // Another fill waiting, too many requests, or the pause after a declined fill.
  busy: msg("err_busy"),
  noAuthenticator: msg("err_no_authenticator"),
  badRequest: msg("err_bad_request"),
  readFailed: msg("err_read_failed"),
  unknownCode: msg("err_unknown_code"),
  alreadyWaiting: msg("err_already_waiting"),
  nothingTyped: msg("err_nothing_typed"),
  tooLong: msg("err_too_long"),
  notSaved: msg("err_save_declined"),
  severalTyped: msg("err_several_typed"),
  savedElsewhere: msg("err_silo_changed"),
  cannotSave: msg("err_cannot_save"),
  navigatedSave: msg("err_navigated_save"),
  otherTabWaiting: msg("err_other_tab_waiting"),
  lockedFill: msg("err_locked_fill"),
  unreachableFill: msg("err_unreachable_fill"),
  lockedSave: msg("err_locked_save"),
  unreachableSave: msg("err_unreachable_save"),
  genericSave: msg("err_generic_save"),
};

export class Service {
  // Tabs with a fill or a save waiting for confirmation in the app.
  private waiting = new Map<number, "fill" | "save">();
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
        waiting: this.waiting.get(tabId) ?? null,
        notice,
        canSave: isAtLeast(version, SAVE_APP_VERSION),
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

  // "Save this login": reads what is typed on the page the list was built
  // for, and offers it to the app, which asks the person. The two values
  // are dropped here once sent.
  async save(tabId: number, listed: string): Promise<SaveResult> {
    const result = await this.saveOnce(tabId, listed);
    // A declined save needs no reminder: the person chose it.
    if (!result.ok && result.message !== TEXT.notSaved) {
      this.notices.set(tabId, { origin: listed, message: result.message });
      this.deps.flag(tabId, true);
    }
    return result;
  }

  private async saveOnce(tabId: number, listed: string): Promise<SaveResult> {
    const origin = fillableOrigin(await this.deps.tabUrl(tabId));
    if (!origin) return { ok: false, message: TEXT.cannotSave };
    if (origin !== listed) return { ok: false, message: TEXT.navigatedSave };
    if (this.waiting.has(tabId)) return { ok: false, message: TEXT.alreadyWaiting };
    if (this.waiting.size > 0) return { ok: false, message: TEXT.otherTabWaiting };

    const read = await this.inPage(tabId, { expectedOrigin: origin, fill: null, read: true });
    if (read.outcome === "wrong-origin") return { ok: false, message: TEXT.navigatedSave };
    if (read.outcome === "several") return { ok: false, message: TEXT.severalTyped };
    if (read.outcome !== "read") return { ok: false, message: TEXT.nothingTyped };
    const login = { username: read.username, password: read.password };
    read.username = read.password = "";
    // Counted in characters, as the app counts them, not in UTF-16 units.
    if ([...login.username].length > MAX_SAVE_FIELD || [...login.password].length > MAX_SAVE_FIELD) {
      login.username = login.password = "";
      return { ok: false, message: TEXT.tooLong };
    }

    this.waiting.set(tabId, "save");
    try {
      const answer = await this.deps.client.request({ type: "save", origin, ...login }, SAVE_TIMEOUT_MS);
      if (answer.outcome !== "saved" && answer.outcome !== "updated") {
        return { ok: false, message: TEXT.badAnswer };
      }
      return { ok: true, updated: answer.outcome === "updated" };
    } catch (error) {
      if (error instanceof ClientError && error.code === "cancelled") return { ok: false, message: TEXT.notSaved };
      // The app's silo changed while it waited: a save, not a list, went stale.
      if (error instanceof ClientError && error.code === "unknown-ref") {
        return { ok: false, message: TEXT.savedElsewhere };
      }
      const view = errorView(error);
      return { ok: false, message: view.state === "error" ? view.message : saveStopped(view.state), view };
    } finally {
      login.username = login.password = "";
      this.waiting.delete(tabId);
    }
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
    this.waiting.set(tabId, "fill");
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
  if (state === "locked") return TEXT.lockedFill;
  if (state === "app-not-running") return TEXT.unreachableFill;
  return TEXT.generic;
}

function saveStopped(state: View["state"]): string {
  if (state === "locked") return TEXT.lockedSave;
  if (state === "app-not-running") return TEXT.unreachableSave;
  return TEXT.genericSave;
}

function pageFailure(result: PageResult | { outcome: "unreachable" }): Extract<FillResult, { ok: false }> {
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
