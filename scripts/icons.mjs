// Renders icons/icon.svg (a copy of the brand icon) to the PNG sizes the
// manifest names. Run after the brand icon changes; the PNGs are committed.

import { Resvg } from "@resvg/resvg-js";
import { readFileSync, writeFileSync } from "node:fs";

const svg = readFileSync("icons/icon.svg");
for (const size of [16, 32, 48, 128]) {
  const png = new Resvg(svg, { fitTo: { mode: "width", value: size } }).render().asPng();
  writeFileSync(`icons/icon-${size}.png`, png);
  console.log(`icons/icon-${size}.png`);
}
