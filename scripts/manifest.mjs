// Composes a target's manifest: manifest/base.json, then manifest/<target>.json
// on top, then the dev key for an unpacked dev build. Used by build.mjs and by
// the tests, so both see the same rules.

import { existsSync, readFileSync } from "node:fs";
import { join } from "node:path";

export const TARGETS = ["chrome", "firefox"];

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));

export function composeManifest(target, { store, version, dir = "manifest" }) {
  if (!TARGETS.includes(target)) throw new Error(`unknown target ${target}`);
  const manifest = {
    ...readJson(join(dir, "base.json")),
    ...readJson(join(dir, `${target}.json`)),
    version,
  };
  // The dev key only pins the unpacked id in Chromium. The store assigns its
  // own, and Firefox takes its id from browser_specific_settings.
  const devKey = join(dir, `${target}.dev.json`);
  if (!store && existsSync(devKey)) Object.assign(manifest, readJson(devKey));
  checkManifest(target, manifest, { store });
  return manifest;
}

// What each target's manifest must look like. A build that breaks one of
// these refuses to finish.
export function checkManifest(target, manifest, { store }) {
  const fail = (message) => {
    throw new Error(`${target} manifest: ${message}`);
  };
  if (manifest.manifest_version !== 3) fail("must be Manifest V3");
  if (store && "key" in manifest) fail("the store build must not carry a key");
  if ("host_permissions" in manifest) fail("must not ask for host permissions");
  const background = manifest.background ?? {};
  if (target === "chrome") {
    if (background.service_worker !== "background.js") fail("needs the background service worker");
    if ("scripts" in background) fail("background.scripts is for Firefox");
  } else {
    if ("key" in manifest) fail("Firefox does not use a key");
    if (!Array.isArray(background.scripts) || background.scripts.join() !== "background.js") {
      fail("needs background.scripts, Firefox has no service worker");
    }
    if ("service_worker" in background) fail("Firefox does not run background.service_worker");
    if ("minimum_chrome_version" in manifest) fail("minimum_chrome_version is for Chromium");
    const gecko = manifest.browser_specific_settings?.gecko;
    if (gecko?.id !== "browser@silentsilo.com") fail("needs the fixed gecko id");
  }
}
