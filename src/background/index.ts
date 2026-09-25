// The background script, a service worker in Chrome and an event page in
// Firefox: the only part of the extension that talks to the desktop app. It
// keeps no state that outlives a fill, beyond how the last one ended on a
// tab, until that tab closes.

import { fillPage, type FillArgs, type FillResult as PageResult } from "../page/fill-page";
import { api } from "../shared/api";
import type { PopupRequest } from "../shared/messages";
import { NativeClient } from "./native-client";
import { HOST_NAME } from "./protocol";
import { Service } from "./service";

const client = new NativeClient({
  connect: () => api.runtime.connectNative(HOST_NAME),
  lastError: () => api.runtime.lastError?.message,
});

// The document the last probe looked at, per tab, so the fill writes into
// that one and not into whatever the tab shows by then. Chrome reports it;
// Firefox does not, and falls back to the top frame and the origin check.
const probed = new Map<number, string>();

const service = new Service({
  client,
  tabUrl: async (tabId) => (await api.tabs.get(tabId)).url,
  runInPage: async (tabId: number, args: FillArgs) => {
    const documentId = args.fill ? probed.get(tabId) : undefined;
    probed.delete(tabId);
    // Top frame only, and only in the tab the person clicked from: activeTab
    // grants nothing else. The isolated world keeps page scripts from
    // replacing what the function calls.
    let frame;
    try {
      [frame] = await api.scripting.executeScript({
        target: documentId ? { tabId, documentIds: [documentId] } : { tabId, frameIds: [0] },
        world: "ISOLATED",
        func: fillPage,
        args: [args],
      });
    } catch (error) {
      // The probed document is gone: the page changed while the person
      // confirmed.
      if (documentId) return { outcome: "wrong-origin" };
      throw error;
    }
    if (!args.fill && frame?.documentId) probed.set(tabId, frame.documentId);
    return frame?.result as PageResult | undefined;
  },
  flag: (tabId, on) => {
    api.action.setBadgeText({ tabId, text: on ? "!" : "" }).catch(() => {});
    if (on) api.action.setBadgeBackgroundColor({ tabId, color: "#ef4444" }).catch(() => {});
  },
});

const popupUrl = api.runtime.getURL("popup.html");

api.runtime.onMessage.addListener((message: PopupRequest, sender, sendResponse) => {
  // Only the extension's own popup may ask. Pages cannot reach this
  // listener, and no content script lives in them to relay.
  if (sender.id !== api.runtime.id || !sender.url?.startsWith(popupUrl)) return false;
  handle(message).then(sendResponse, () => sendResponse(undefined));
  return true;
});

api.tabs.onRemoved.addListener((tabId) => {
  service.forget(tabId);
  probed.delete(tabId);
});

async function handle(message: PopupRequest): Promise<unknown> {
  switch (message.kind) {
    case "open":
      return service.open(message.tabId);
    case "search":
      return service.search(message.query);
    case "fill":
      return service.fill(message.tabId, message.ref, message.origin);
    case "show":
      return service.show();
    case "seen":
      service.seen(message.tabId);
      return null;
  }
}
