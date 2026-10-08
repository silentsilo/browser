/// <reference types="node" />
import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { msg, uiLanguage, type MessageKey } from "../src/shared/i18n";

interface Entry {
  message: string;
  description: string;
  placeholders?: Record<string, { content: string; example?: string }>;
}

const LANGUAGES = ["de", "en", "es", "fr", "it", "pl", "pt_BR", "ro"];
const read = (lang: string): Record<string, Entry> =>
  JSON.parse(readFileSync(join("_locales", lang, "messages.json"), "utf8"));
const en = read("en");
const EM_DASH = String.fromCharCode(0x2014);

// The $NAME$ references in a message, as the browser matches them.
const references = (message: string) =>
  [...message.matchAll(/\$([A-Za-z0-9_@]+)\$/g)].map((m) => m[1].toLowerCase()).sort();

describe("the locales", () => {
  it("are exactly the eight languages", () => {
    expect(readdirSync("_locales").sort()).toEqual(LANGUAGES);
  });

  it.each(LANGUAGES)("%s has exactly the English keys, each with a message and a note", (lang) => {
    const messages = read(lang);
    expect(Object.keys(messages).sort()).toEqual(Object.keys(en).sort());
    for (const [key, entry] of Object.entries(messages)) {
      expect(entry.message.trim(), key).not.toBe("");
      expect(entry.description.trim(), key).not.toBe("");
    }
  });

  it.each(LANGUAGES)("%s has the English placeholders, and uses each of them", (lang) => {
    for (const [key, entry] of Object.entries(read(lang))) {
      const english = en[key];
      const contents = (e: Entry) =>
        Object.fromEntries(Object.entries(e.placeholders ?? {}).map(([name, p]) => [name, p.content]));
      expect(contents(entry), key).toEqual(contents(english));
      expect(references(entry.message), key).toEqual(references(english.message));
      expect([...new Set(references(entry.message))], key).toEqual(Object.keys(entry.placeholders ?? {}).sort());
      // A bare $1 would skip the named placeholder and its note.
      expect(entry.message, key).not.toMatch(/\$\d/);
    }
  });

  it.each(LANGUAGES)("%s has no em-dash", (lang) => {
    for (const [key, entry] of Object.entries(read(lang))) {
      expect(entry.message, key).not.toContain(EM_DASH);
      expect(entry.description, key).not.toContain(EM_DASH);
    }
  });

  // Chrome refuses a longer manifest description.
  it.each(LANGUAGES)("%s keeps the store description within 132 characters", (lang) => {
    expect([...read(lang).ext_description.message].length).toBeLessThanOrEqual(132);
  });

  it("every English key is used by the code or the manifest", () => {
    const sources = ["manifest/base.json"];
    const walk = (dir: string) => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const path = join(dir, entry.name);
        if (entry.isDirectory()) walk(path);
        else if (path.endsWith(".ts")) sources.push(path);
      }
    };
    walk("src");
    const code = sources.map((path) => readFileSync(path, "utf8")).join("\n");
    for (const key of Object.keys(en)) expect(code, key).toMatch(new RegExp(`"${key}"|__MSG_${key}__`));
  });
});

describe("msg", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  it("reads the English file where the browser's API is missing", () => {
    expect(msg("popup_open_app")).toBe("Open SilentSilo");
    expect(msg("popup_logins_for", { site: "github.com" })).toBe("Logins for github.com");
    expect(msg("popup_update_body_installed", { installed: "1.1.0", required: "1.2.0" })).toBe(
      "SilentSilo 1.1.0 is installed. This extension needs version 1.2.0 or later.",
    );
    expect(uiLanguage()).toBe("en");
  });

  it("asks the browser, with the values in the placeholders' positions", () => {
    const getMessage = vi.fn((key: MessageKey, substitutions: string[]) => `${key}:${substitutions.join("|")}`);
    vi.stubGlobal("chrome", { i18n: { getMessage, getUILanguage: () => "pt-BR" } });
    expect(msg("popup_update_body_installed", { installed: "1.1.0", required: "1.2.0" })).toBe(
      "popup_update_body_installed:1.1.0|1.2.0",
    );
    expect(msg("popup_open_app")).toBe("popup_open_app:");
    expect(uiLanguage()).toBe("pt-BR");
  });

  it("prefers Firefox's browser namespace, and falls back to English on an empty answer", () => {
    vi.stubGlobal("chrome", { i18n: { getMessage: () => "from chrome", getUILanguage: () => "de" } });
    vi.stubGlobal("browser", { i18n: { getMessage: () => "", getUILanguage: () => "fr" } });
    expect(msg("popup_open_app")).toBe("Open SilentSilo");
    expect(uiLanguage()).toBe("fr");
  });
});
