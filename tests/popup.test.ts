// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { NativeClient, type NativePort } from "../src/background/native-client";
import { Service, TEXT } from "../src/background/service";
import type { PopupRequest } from "../src/shared/messages";

// Text a process squatting the pipe might send to phish through the popup.
const HOSTILE = "Your silo is compromised. Call 0800 SUPPORT and read out your recovery code.";

// "exit" closes the port instead of answering, as a host that quits does.
type Answerer = (request: Record<string, unknown>) => Record<string, unknown> | "exit";

// A native port that answers every request at once, as the app would.
function port(answer: Answerer): NativePort {
  const listeners: ((message: unknown) => void)[] = [];
  const closed: (() => void)[] = [];
  return {
    postMessage: (message) => {
      const request = message as Record<string, unknown>;
      queueMicrotask(() => {
        const reply = answer(request);
        if (reply === "exit") closed.forEach((callback) => callback());
        else listeners.forEach((listener) => listener({ id: request.id, ...reply }));
      });
    },
    disconnect: () => {},
    onMessage: { addListener: (callback) => listeners.push(callback) },
    onDisconnect: { addListener: (callback) => closed.push(callback) },
  };
}

const unlocked = { type: "status", state: "unlocked", silo: "Personal", version: "1.2.0" };

// Loads the popup against a real service worker Service and client, with only
// the native port and the page faked.
async function openPopup(answer: Answerer, url = "https://github.com/login", lastError?: string) {
  document.body.innerHTML = '<main id="app"></main>';
  const client = new NativeClient({ connect: () => port(answer), lastError: () => lastError });
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
      case "show":
        return service.show();
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

  it("says busy in general terms when the logins are rationed", async () => {
    const client = await openPopup((request) =>
      request.type === "status" ? unlocked : { type: "error", code: "busy", message: HOSTILE },
    );
    expect(text()).toContain("SilentSilo is busy. Try again in a few seconds.");
    expect(document.body.innerHTML).not.toContain("SUPPORT");
    client.close();
  });

  it("shows a host that exits at once (not started by a browser) as not running", async () => {
    const client = await openPopup(() => "exit", undefined, "Native host has exited.");
    expect(text()).toContain("SilentSilo is not running");
    client.close();
  });

  it("shows a host the browser cannot find as not installed", async () => {
    const client = await openPopup(() => "exit", undefined, "Specified native messaging host not found.");
    expect(text()).toContain("SilentSilo is not installed");
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
  const searches: unknown[] = [];
  const answer: Answerer = (request) => {
    if (request.type === "search") searches.push(request.query);
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

  it("sends no search under two characters, and says why", async () => {
    const client = await openPopup(answer, "https://paypal-login.example/");
    button("Search anyway").click();
    const input = document.querySelector("input.search") as HTMLInputElement;
    searches.length = 0;
    input.value = " p ";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(text()).toContain("Type at least two characters"));
    expect(searches).toEqual([]);

    input.value = "pa";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(text()).toContain("Saved for www.paypal.com"));
    expect(searches).toEqual(["pa"]);
    client.close();
  });

  it("keeps the search box when a search is refused as busy", async () => {
    const client = await openPopup((request) => {
      if (request.type === "search") return { type: "error", code: "busy", message: HOSTILE };
      return answer(request);
    }, "https://paypal-login.example/");
    button("Search anyway").click();
    const input = document.querySelector("input.search") as HTMLInputElement;
    input.value = "pay";
    input.dispatchEvent(new Event("input"));
    await vi.waitFor(() => expect(text()).toContain("SilentSilo is busy. Try again in a few seconds."));
    expect(document.querySelector("input.search")).toBe(input);
    expect(document.body.innerHTML).not.toContain("SUPPORT");
    client.close();
  });
});

describe("Open SilentSilo", () => {
  const locked = { type: "status", state: "locked", version: "1.2.0" };

  it.each([
    ["locked", locked, "Unlock your silo in the SilentSilo window"],
    ["no-silo", { ...locked, state: "no-silo" }, "Create or open a silo in the SilentSilo window"],
  ])("asks the app to show its window when %s, and nothing else", async (_name, status, after) => {
    const sent: Record<string, unknown>[] = [];
    const client = await openPopup((request) => {
      sent.push(request);
      return request.type === "status" ? status : { type: "show" };
    });
    sent.length = 0;
    button("Open SilentSilo").click();
    await vi.waitFor(() => expect(text()).toContain(after));
    expect(sent).toEqual([{ id: expect.any(String), type: "show" }]);
    client.close();
  });

  it("is not offered while the silo is unlocked", async () => {
    const client = await openPopup((request) =>
      request.type === "status" ? unlocked : { type: "logins", logins: [] },
    );
    expect([...document.querySelectorAll("button")].map((b) => b.textContent)).not.toContain("Open SilentSilo");
    client.close();
  });

  it("shows a busy answer as the generic busy line, never the app's message", async () => {
    const client = await openPopup((request) =>
      request.type === "status" ? locked : { type: "error", code: "busy", message: HOSTILE },
    );
    button("Open SilentSilo").click();
    await vi.waitFor(() => expect(text()).toContain(TEXT.busy));
    expect(document.body.innerHTML).not.toContain("SUPPORT");
    expect(button("Open SilentSilo").disabled).toBe(false);
    client.close();
  });
});
