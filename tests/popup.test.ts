// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeClient, type NativePort } from "../src/background/native-client";
import { Service, TEXT } from "../src/background/service";
import type { PopupRequest } from "../src/shared/messages";

// Text a process squatting the pipe might send to phish through the popup.
const HOSTILE = "Your silo is compromised. Call 0800 SUPPORT and read out your recovery code.";

type Answerer = (request: Record<string, unknown>) => Record<string, unknown>;

// A native port that answers every request at once, as the app would.
function port(answer: Answerer): NativePort {
  const listeners: ((message: unknown) => void)[] = [];
  return {
    postMessage: (message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => listeners.forEach((listener) => listener({ id: request.id, ...answer(request) })));
    },
    disconnect: () => {},
    onMessage: { addListener: (callback) => listeners.push(callback) },
    onDisconnect: { addListener: () => {} },
  };
}

const unlocked = { type: "status", state: "unlocked", silo: "Personal", version: "1.2.0" };

// Loads the popup against a real service worker Service and client, with only
// the native port and the page faked.
async function openPopup(answer: Answerer, url = "https://github.com/login") {
  document.body.innerHTML = '<main id="app"></main>';
  const client = new NativeClient({ connect: () => port(answer), lastError: () => undefined });
  const service = new Service({
    client,
    tabUrl: async () => url,
    runInPage: async (_tab, args) => (args.fill ? { outcome: "filled", usernameFilled: true } : { outcome: "ready" }),
    flag: () => {},
  });
  const handle = async (request: PopupRequest): Promise<unknown> => {
    switch (request.kind) {
      case "open":
        return service.open(request.tabId);
      case "search":
        return service.search(request.query);
      case "fill":
        return service.fill(request.tabId, request.ref);
      case "seen":
        service.seen(request.tabId);
        return null;
    }
  };
  vi.stubGlobal("chrome", {
    tabs: { query: async () => [{ id: 7 }] },
    runtime: { sendMessage: (request: PopupRequest) => handle(request) },
  });
  window.close = vi.fn();
  vi.resetModules();
  await import("../src/popup/popup");
  await vi.waitFor(() => expect(text()).not.toContain("Asking SilentSilo"));
  return client;
}

function text(): string {
  return document.body.textContent ?? "";
}

function button(label: string): HTMLButtonElement {
  const found = [...document.querySelectorAll("button")].find((b) => b.textContent?.includes(label));
  if (!found) throw new Error(`no button "${label}" in: ${text()}`);
  return found;
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("error answers", () => {
  it.each([
    ["cancelled", TEXT.cancelled],
    ["busy", TEXT.busy],
    ["bad-request", TEXT.badRequest],
    ["unknown-ref", TEXT.unknownRef],
    ["no-authenticator", TEXT.noAuthenticator],
    ["made-up-code", TEXT.unknownCode],
  ])("a fill refused with %s shows the extension's own text, never the app's message", async (code, shown) => {
    const client = await openPopup((request) => {
      if (request.type === "status") return unlocked;
      if (request.type === "logins") {
        return { type: "logins", logins: [{ ref: "r1", label: "GitHub", username: "alex" }] };
      }
      return { type: "error", code, message: HOSTILE };
    });
    button("GitHub").click();
    await vi.waitFor(() => expect(text()).toContain(shown));
    expect(document.body.innerHTML).not.toContain("SUPPORT");
    client.close();
  });

  it("an error while opening shows the extension's own text, never the app's message", async () => {
    const client = await openPopup(() => ({ type: "error", code: "made-up-code", message: HOSTILE }));
    expect(text()).toContain(TEXT.unknownCode);
    expect(document.body.innerHTML).not.toContain("SUPPORT");
    client.close();
  });

  it("does not echo a version string that is not a version number", async () => {
    const client = await openPopup(() => ({ ...unlocked, version: `1.0.0 ${HOSTILE}` }));
    expect(text()).toContain("Update SilentSilo");
    expect(document.body.innerHTML).not.toContain("SUPPORT");
    client.close();
  });
});

describe("a site with nothing saved", () => {
  const answer: Answerer = (request) => {
    if (request.type === "status") return unlocked;
    if (request.type === "logins") return { type: "logins", logins: [] };
    return {
      type: "search",
      logins: [
        { ref: "r1", label: "PayPal", username: "alex", site: "www.paypal.com" },
        { ref: "r2", label: "Old router", username: "admin", site: "" },
      ],
    };
  };

  it("warns first, and shows no search box until the person clicks Search anyway", async () => {
    const client = await openPopup(answer, "https://paypal-login.example/");
    expect(text()).toContain(
      "Nothing is saved for paypal-login.example. If you expected a login here, check the address: this may not be the site you think.",
    );
    expect(document.querySelector("input")).toBeNull();
    expect(document.activeElement).toBe(document.body);

    button("Search anyway").click();
    const input = document.querySelector("input.search") as HTMLInputElement;
    expect(input).not.toBeNull();
    expect(document.activeElement).toBe(input);
    client.close();
  });

  it("labels each search result with the site it was saved for", async () => {
    const client = await openPopup(answer, "https://paypal-login.example/");
    button("Search anyway").click();
    const input = document.querySelector("input.search") as HTMLInputElement;
    input.value = "pay";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(text()).toContain("Saved for www.paypal.com"));
    const saved = [...document.querySelectorAll(".saved")].map((node) => [node.textContent, node.className]);
    expect(saved).toEqual([
      ["Saved for www.paypal.com", "saved other"],
      ["Saved without a site", "saved other"],
    ]);
    client.close();
  });
});
