// Builds one browser target into dist/<target>/.
//
//   node scripts/build.mjs chrome          dev build, loadable unpacked, stable id
//   node scripts/build.mjs chrome --store  store build without the `key`, zipped
//
// A browser is a manifest overlay in manifest/<target>.json. Firefox gets its
// own overlay (background.scripts, browser_specific_settings) when it ships.

import { build } from "esbuild";
import { zipSync } from "fflate";
import { cpSync, existsSync, mkdirSync, readFileSync, readdirSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join, relative } from "node:path";

const TARGETS = ["chrome"];
const target = process.argv[2];
const store = process.argv.includes("--store");
if (!TARGETS.includes(target)) {
  console.error(`usage: node scripts/build.mjs <${TARGETS.join("|")}> [--store]`);
  process.exit(1);
}

const pkg = JSON.parse(readFileSync("package.json", "utf8"));
const out = store ? join("dist", "store", target) : join("dist", target);
rmSync(out, { recursive: true, force: true });
mkdirSync(out, { recursive: true });

const readJson = (path) => JSON.parse(readFileSync(path, "utf8"));
const manifest = {
  ...readJson("manifest/base.json"),
  ...readJson(`manifest/${target}.json`),
  version: pkg.version,
};
// The dev key only pins the unpacked id. The store assigns its own.
const devKey = `manifest/${target}.dev.json`;
if (!store && existsSync(devKey)) Object.assign(manifest, readJson(devKey));
if (store && "key" in manifest) throw new Error("the store build must not carry a key");
writeFileSync(join(out, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);

await build({
  entryPoints: { background: "src/background/index.ts", popup: "src/popup/popup.ts" },
  outdir: out,
  bundle: true,
  format: "iife",
  target: "chrome120",
  minify: store,
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
