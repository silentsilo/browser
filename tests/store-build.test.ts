/// <reference types="node" />
// The store builds, bundled as `npm run package` bundles them, driven through
// a whole fill. The page function is serialised and evaluated in the page's
// own scope, as chrome.scripting does, so a minifier that leaves it calling
// a helper outside its body fails here rather than in a store release.
import { build } from "esbuild";
import { JSDOM } from "jsdom";
import { describe, expect, it } from "vitest";
import { bundleOptions } from "../scripts/bundle.mjs";

const PAGE_URL = "https://example.com/login";

async function backgroundBundle(target: string): Promise<string> {
  const result = await build({
    ...bundleOptions(target, { store: true }),
    entryPoints: { background: "src/background/index.ts" },
    outdir: "dist/unused",
    write: false,
    logLevel: "silent",
  });
  const file = result.outputFiles?.find((out) => out.path.endsWith("background.js"));
  if (!file) throw new Error("no background.js in the bundle");
  return file.text;
}

type Listener = (message: unknown, sender: unknown, respond: (answer: unknown) => void) => boolean;

// Just enough of the extension API for one fill, with the app answering
// over a fake native port.
function fakeApi(dom: JSDOM) {
  let onMessage: Listener | undefined;
  const portListeners: ((message: unknown) => void)[] = [];
  const answers: Record<string, Record<string, unknown>> = {
    status: { type: "status", state: "unlocked", silo: "Personal", version: "1.2.0" },
    logins: { type: "logins", logins: [{ ref: "r1", label: "Example", username: "alex" }] },
    fill: { type: "fill", username: "alex@example.com", password: "hunter2" },
  };
  const api = {
    runtime: {
      id: "ext",
      lastError: undefined,
      getURL: (path: string) => `chrome-extension://ext/${path}`,
      onMessage: { addListener: (listener: Listener) => (onMessage = listener) },
      connectNative: () => ({
        postMessage: (message: { id: string; type: string }) =>
          queueMicrotask(() => portListeners.forEach((l) => l({ id: message.id, ...answers[message.type] }))),
        disconnect: () => {},
        onMessage: { addListener: (listener: (message: unknown) => void) => portListeners.push(listener) },
        onDisconnect: { addListener: () => {} },
      }),
    },
    tabs: {
      get: async () => ({ url: PAGE_URL }),
      onRemoved: { addListener: () => {} },
    },
    scripting: {
      executeScript: async ({ func, args }: { func: (...a: unknown[]) => unknown; args: unknown[] }) => {
        // What chrome.scripting does: the source alone, run in the page.
        const inPage = dom.window.eval(`(${func.toString()})`) as (...a: unknown[]) => unknown;
        return [{ result: inPage(...structuredClone(args)) }];
      },
    },
    action: { setBadgeText: async () => {}, setBadgeBackgroundColor: async () => {} },
  };
  const send = (message: unknown) =>
    new Promise<Record<string, unknown>>((resolve) => {
      if (!onMessage) throw new Error("the background script registered no listener");
      onMessage(message, { id: "ext", url: "chrome-extension://ext/popup.html" }, (answer) =>
        resolve(answer as Record<string, unknown>),
      );
    });
  return { api, send };
}

describe("the store build", () => {
  // Chrome's store build is minified; Firefox's is not, and reaches the API
  // as `browser`.
  it.each([
    ["chrome", "chrome"],
    ["firefox", "browser"],
  ])("%s fills a page with the serialised page function", async (target, name) => {
    const code = await backgroundBundle(target);
    const dom = new JSDOM(
      `<form><input name="u" type="email"><input name="p" type="password"></form>`,
      { url: PAGE_URL, runScripts: "outside-only" },
    );
    const { api, send } = fakeApi(dom);
    new Function("chrome", "globalThis", code)(
      name === "chrome" ? api : undefined,
      name === "browser" ? { browser: api } : {},
    );

    const view = await send({ kind: "open", tabId: 1 });
    expect(view).toMatchObject({ state: "ready", origin: "https://example.com", site: "example.com" });
    const result = await send({ kind: "fill", tabId: 1, ref: "r1", origin: view.origin });
    expect(result).toEqual({ ok: true, usernameFilled: true });

    const value = (selector: string) => (dom.window.document.querySelector(selector) as HTMLInputElement).value;
    expect(value("[name=u]")).toBe("alex@example.com");
    expect(value("[name=p]")).toBe("hunter2");
  });
});
