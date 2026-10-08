// Every text the extension shows comes through msg(). The browser picks the
// language from _locales/; where its i18n API is missing (the tests), the
// English file is read here, so the tests see the English the extension shows.

import en from "../../_locales/en/messages.json";

export type MessageKey = keyof typeof en;

// A message with placeholders takes their values by name.
type Values<K extends MessageKey> = (typeof en)[K] extends { placeholders: infer P }
  ? { [N in keyof P]: string }
  : never;
type Args<K extends MessageKey> = [Values<K>] extends [never] ? [] : [values: Values<K>];

interface Entry {
  message: string;
  placeholders?: Record<string, { content: string }>;
}

interface I18nApi {
  getMessage(name: string, substitutions?: string[]): string;
  getUILanguage(): string;
}

const english = en as Record<string, Entry>;

// Looked up on every call, not through shared/api: the background tests run
// with no `chrome` at all, and the popup tests install theirs after import.
function i18n(): I18nApi | undefined {
  const scope = globalThis as { browser?: { i18n?: I18nApi }; chrome?: { i18n?: I18nApi } };
  return (scope.browser ?? scope.chrome)?.i18n;
}

export function msg<K extends MessageKey>(key: K, ...args: Args<K>): string {
  // Named values to the positional $1..$9 the browser takes, by the English
  // placeholders (every locale carries the same ones).
  const values = (args[0] ?? {}) as Record<string, string>;
  const substitutions: string[] = [];
  for (const [name, { content }] of Object.entries(english[key].placeholders ?? {})) {
    substitutions[Number(content.slice(1)) - 1] = values[name];
  }
  return i18n()?.getMessage(key, substitutions) || format(english[key], substitutions);
}

// The language the browser shows the extension in.
export function uiLanguage(): string {
  return i18n()?.getUILanguage() || "en";
}

// What the browser does with a message: $NAME$ to its placeholder's content,
// then $1..$9 to the substitutions.
function format(entry: Entry, substitutions: string[]): string {
  const placeholders = entry.placeholders ?? {};
  return entry.message
    .replace(/\$([A-Za-z0-9_@]+)\$/g, (_, name: string) => placeholders[name.toLowerCase()]?.content ?? "")
    .replace(/\$(\d)/g, (_, n: string) => substitutions[Number(n) - 1] ?? "");
}
