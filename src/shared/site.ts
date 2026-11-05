import { getDomain } from "tldts";

// The site a host belongs to: its registrable domain as the Public Suffix
// List reads it, private suffixes included, the app's rule. An address, a
// single name or a public suffix is its own site.
export function siteOf(host: string): string {
  const name = host.toLowerCase();
  if (name.startsWith("[")) return name;
  return getDomain(name, { allowPrivateDomains: true }) ?? name.replace(/^www\./, "");
}

// Whether a search result was saved for the tab's site, for the popup's
// colour only. The same site and port, as the app and the tab give them; the
// app's confirmation applies the whole rule.
export function sameSite(saved: string, tab: string): boolean {
  const a = split(saved);
  const b = split(tab);
  return a.host !== "" && siteOf(a.host) === siteOf(b.host) && a.port === b.port;
}

// `host`, `host:port`, `[v6]` or `[v6]:port`.
function split(value: string): { host: string; port: string } {
  const match = /^(.*?)(?::(\d+))?$/.exec(value.trim().toLowerCase());
  return { host: match?.[1] ?? "", port: match?.[2] ?? "" };
}
