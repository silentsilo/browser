// Whether a search result was saved for the tab's site, for the popup's
// colour only. Host and port as the app and the tab give them, the host with
// or without www.: the app's rule, less the scheme, which a result's `site`
// does not carry. The app's confirmation applies the whole rule.
export function sameSite(saved: string, tab: string): boolean {
  const a = split(saved);
  const b = split(tab);
  return a.host !== "" && a.host === b.host && a.port === b.port;
}

// `host`, `host:port`, `[v6]` or `[v6]:port`.
function split(value: string): { host: string; port: string } {
  const match = /^(.*?)(?::(\d+))?$/.exec(value.trim().toLowerCase());
  return { host: (match?.[1] ?? "").replace(/^www\./, ""), port: match?.[2] ?? "" };
}
