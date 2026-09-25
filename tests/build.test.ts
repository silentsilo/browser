/// <reference types="node" />
import { cpSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { TARGETS, checkManifest, composeManifest } from "../scripts/manifest.mjs";

const version = "9.8.7";
const base = JSON.parse(readFileSync("manifest/base.json", "utf8"));
const background = (m: Record<string, unknown>) => m.background as Record<string, unknown>;

describe("manifests", () => {
  it("builds both browsers", () => {
    expect([...TARGETS]).toEqual(["chrome", "firefox"]);
  });

  it.each(TARGETS.flatMap((target) => [true, false].map((store) => [target, store] as const)))(
    "%s (store: %s) keeps the permissions and the CSP of the base, and no host permissions",
    (target, store) => {
      const m = composeManifest(target, { store, version });
      expect(m.manifest_version).toBe(3);
      expect(m.version).toBe(version);
      expect(m.permissions).toEqual(["nativeMessaging", "activeTab", "scripting"]);
      expect(m.content_security_policy).toEqual(base.content_security_policy);
      expect(m).not.toHaveProperty("host_permissions");
      expect(m).not.toHaveProperty("optional_permissions");
      expect(m).not.toHaveProperty("content_scripts");
    },
  );

  it.each([
    ["externally_connectable", { matches: ["https://*/*"] }],
    ["web_accessible_resources", [{ resources: ["popup.html"], matches: ["<all_urls>"] }]],
    ["optional_host_permissions", ["https://*/*"]],
    ["optional_permissions", ["tabs"]],
    ["content_scripts", [{ matches: ["<all_urls>"], js: ["x.js"] }]],
  ])("refuses a manifest that declares %s", (key, value) => {
    const m = { ...composeManifest("chrome", { store: true, version }), [key]: value };
    expect(() => checkManifest("chrome", m, { store: true })).toThrow(key);
  });

  it("refuses a permission beyond the three", () => {
    const m = composeManifest("chrome", { store: true, version });
    m.permissions = [...(m.permissions as string[]), "tabs"];
    expect(() => checkManifest("chrome", m, { store: true })).toThrow("permissions");
  });

  it.each(TARGETS)("the %s store build carries no key", (target) => {
    expect(composeManifest(target, { store: true, version })).not.toHaveProperty("key");
  });

  // The dev key is local, never committed, so a clean checkout builds without it.
  it("the chrome dev build carries the local dev key only when there is one", () => {
    const hasKey = existsSync("manifest/chrome.dev.json");
    expect("key" in composeManifest("chrome", { store: false, version })).toBe(hasKey);
    expect(composeManifest("firefox", { store: false, version })).not.toHaveProperty("key");
  });

  it("chrome runs the background as a service worker", () => {
    const m = composeManifest("chrome", { store: true, version });
    expect(background(m)).toEqual({ service_worker: "background.js" });
    expect(m.minimum_chrome_version).toBe("120");
    expect(m).not.toHaveProperty("browser_specific_settings");
  });

  it("firefox runs the background as an event page, with the fixed id", () => {
    const m = composeManifest("firefox", { store: true, version });
    expect(background(m)).toEqual({ scripts: ["background.js"] });
    expect(m).not.toHaveProperty("minimum_chrome_version");
    expect(m.browser_specific_settings).toEqual({
      gecko: {
        id: "browser@silentsilo.com",
        strict_min_version: "140.0",
        data_collection_permissions: { required: ["none"] },
      },
    });
  });
});

describe("the manifest check", () => {
  const good = (target: string) => composeManifest(target, { store: true, version });

  it("refuses a key in a store build", () => {
    expect(() => checkManifest("chrome", { ...good("chrome"), key: "k" }, { store: true })).toThrow(/key/);
  });

  it("refuses a key in any firefox build", () => {
    expect(() => checkManifest("firefox", { ...good("firefox"), key: "k" }, { store: false })).toThrow(/key/);
  });

  it("refuses a service worker for firefox and background scripts for chrome", () => {
    const ff = good("firefox");
    expect(() =>
      checkManifest("firefox", { ...ff, background: { service_worker: "background.js" } }, { store: true }),
    ).toThrow(/background/);
    expect(() =>
      checkManifest("chrome", { ...good("chrome"), background: { scripts: ["background.js"] } }, { store: true }),
    ).toThrow(/service worker/);
  });

  it("refuses host permissions", () => {
    expect(() =>
      checkManifest("chrome", { ...good("chrome"), host_permissions: ["<all_urls>"] }, { store: true }),
    ).toThrow(/host permissions/);
  });

  it("refuses a firefox manifest without the fixed id", () => {
    expect(() =>
      checkManifest("firefox", { ...good("firefox"), browser_specific_settings: { gecko: {} } }, { store: true }),
    ).toThrow(/gecko id/);
  });

  it("stops a dev key that lands in a store build through the overlay", () => {
    const dir = mkdtempSync(join(tmpdir(), "manifest-"));
    cpSync("manifest", dir, { recursive: true });
    const chrome = JSON.parse(readFileSync(join(dir, "chrome.json"), "utf8"));
    writeFileSync(join(dir, "chrome.json"), JSON.stringify({ ...chrome, key: "k" }));
    expect(() => composeManifest("chrome", { store: true, version, dir })).toThrow(/key/);
  });
});
