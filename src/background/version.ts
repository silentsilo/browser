// Compares the app's version with the lowest one that speaks the protocol.
// A prerelease counts as its release: 1.2.0-rc.1 is the build that brings
// the protocol, so it must not be told to update to 1.2.0.
export function isAtLeast(version: string, minimum: string): boolean {
  const have = parts(version);
  const need = parts(minimum);
  if (!have || !need) return false;
  for (let i = 0; i < 3; i++) {
    if (have[i] !== need[i]) return have[i] > need[i];
  }
  return true;
}

function parts(version: string): number[] | null {
  const match = /^v?(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/.exec(version.trim());
  return match ? match.slice(1, 4).map(Number) : null;
}
