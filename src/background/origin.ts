// Which pages can be filled, by the rule in docs/PROTOCOL.md: https, and
// plain http only on this computer's own addresses.

export function fillableOrigin(url: string | undefined): string | null {
  if (!url) return null;
  let parsed: URL;
  try {
    parsed = new URL(url);
  } catch {
    return null;
  }
  if (parsed.protocol === "https:") return parsed.origin;
  if (parsed.protocol === "http:" && isLoopback(parsed.hostname)) return parsed.origin;
  return null;
}

function isLoopback(hostname: string): boolean {
  if (hostname === "localhost" || hostname === "[::1]") return true;
  return /^127\.\d{1,3}\.\d{1,3}\.\d{1,3}$/.test(hostname);
}

// What the popup shows as the site: the host, with the port when there is one.
export function siteName(origin: string): string {
  return new URL(origin).host;
}
