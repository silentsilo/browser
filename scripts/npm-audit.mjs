// `npm audit`, failing on high and critical advisories, with ignores that
// each carry a reason: npm has no ignore list of its own, and cargo audit's
// ignores in the Rust repositories work the same way.
//
//   node scripts/npm-audit.mjs
import { execFileSync } from "node:child_process";

/** GHSA id -> why it does not apply. Re-check each when its package moves. */
const IGNORED = {};

const FAILING = new Set(["high", "critical"]);

/** An audit that did not run is a failure, never a clean result. */
function broken(why) {
  console.error(`npm audit did not run: ${why}`);
  process.exit(2);
}

let output;
try {
  output = execFileSync("npm", ["audit", "--json"], {
    encoding: "utf8",
    shell: process.platform === "win32",
    stdio: ["ignore", "pipe", "inherit"],
  });
} catch (e) {
  // npm audit exits non-zero when it finds anything; the JSON is still there.
  if (typeof e.stdout !== "string" || !e.stdout.trim()) broken(e.message);
  output = e.stdout;
}

let report;
try {
  report = JSON.parse(output);
} catch {
  broken("its output is not JSON");
}
// A registry or lockfile failure still prints JSON, with an `error` in it.
if (report?.error) broken(report.error.summary || report.error.code || "it reported an error");
if (typeof report?.vulnerabilities !== "object" || report.vulnerabilities === null) {
  broken("the report has no vulnerabilities section");
}

const advisories = new Map();
for (const vuln of Object.values(report.vulnerabilities)) {
  for (const via of vuln.via) {
    if (typeof via !== "object") continue;
    const id = via.url?.split("/").pop() ?? String(via.source);
    advisories.set(id, { ...via, package: vuln.name });
  }
}

let failed = false;
for (const [id, a] of advisories) {
  if (!FAILING.has(a.severity)) continue;
  if (IGNORED[id]) {
    console.log(`ignored ${id} (${a.package}): ${IGNORED[id]}`);
    continue;
  }
  console.error(`${a.severity} ${id} in ${a.package}: ${a.title}`);
  failed = true;
}
for (const id of Object.keys(IGNORED)) {
  if (!advisories.has(id)) console.log(`no longer reported, drop the ignore: ${id}`);
}
if (failed) process.exit(1);
console.log("npm audit: nothing high or critical outside the ignores");
