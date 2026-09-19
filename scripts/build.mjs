// Builds browser targets into dist/<target>/.
//
//   node scripts/build.mjs chrome         dev build, loadable unpacked, stable id
//   node scripts/build.mjs firefox        dev build, loadable as a temporary add-on
//   node scripts/build.mjs all            both
//   node scripts/build.mjs all --store    store builds without any `key`, zipped
//
// A browser is a manifest overlay in manifest/<target>.json, composed and
// checked by scripts/manifest.mjs. The code is the same for every target:
// Chrome runs background.js as a service worker, Firefox as an event page.

import { build } from "esbuild";
import { zipSync } from "fflate";
import { cpSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";
import { TARGETS, composeManifest } from "./manifest.mjs";

// The oldest browser each target supports, as its manifest says.
const ESBUILD_TARGET = { chrome: "chrome120", firefox: "firefox140" };

const arg = process.argv[2];
const store = process.argv.includes("--store");
if (arg !== "all" && !TARGETS.includes(arg)) {
  console.error(`usage: node scripts/build.mjs <${TARGETS.join("|")}|all> [--store]`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
for (const target of arg === "all" ? TARGETS : [arg]) await buildTarget(target);

async function buildTarget(target) {
  const out = store ? join("dist", "store", target) : join("dist", target);
  rmSync(out, { recursive: true, force: true });
  mkdirSync(out, { recursive: true });

  const manifest = composeManifest(target, { store, version: pkg.version });
  writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

  await build({
    entryPoints: { background: "src/background/index.ts", popup: "src/popup/popup.ts" },
    outdir: out,
    bundle: true,
    format: "iife",
    target: ESBUILD_TARGET[target],
    // addons.mozilla.org reviewers read the shipped code, so Firefox stays
    // unminified.
    minify: store && target !== "firefox",
    sourcemap: store ? false : "linked",
    legalComments: "none",
    logLevel: "warning",
  });

  cpSync("src/popup/popup.html", join(out, "popup.html"));
  cpSync("src/popup/popup.css", join(out, "popup.css"));
  mkdirSync(join(out, "icons"));
  for (const size of [16, 32, 48, 128]) cpSync(`icons/icon-${size}.png`, join(out, "icons", `icon-${size}.png`));

  const fonts = "node_modules/@fontsource-variable/plus-jakarta-sans";
  mkdirSync(join(out, "fonts"));
  for (const face of ["latin", "latin-ext"]) {
    const file = `plus-jakarta-sans-${face}-wght-normal.woff2`;
    cpSync(join(fonts, "files", file), join(out, "fonts", file));
  }
  cpSync(join(fonts, "LICENSE"), join(out, "fonts", "OFL.txt"));
  cpSync("LICENSE", join(out, "LICENSE"));

  if (store) {
    // Files at the root of the zip, manifest.json included: both stores
    // want it that way.
    const files = {};
    const walk = (dir) => {
      for (const name of readdirSync(dir)) {
        const path = join(dir, name);
        if (statSync(path).isDirectory()) walk(path);
        else files[relative(out, path).split("\\").join("/")] = readFileSync(path);
      }
    };
    walk(out);
    const zip = join("dist", `silentsilo-${target}-${pkg.version}.zip`);
    writeFileSync(zip, zipSync(files, { level: 9 }));
    console.log(`packaged ${zip}`);
  } else {
    console.log(`built ${out}`);
  }
}
