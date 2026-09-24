// The esbuild options for a target, shared by build.mjs and the tests, so the
// tests bundle the code exactly as a store build does.

// The oldest browser each target supports, as its manifest says.
const ESBUILD_TARGET = { chrome: "chrome120", firefox: "firefox140" };

export function bundleOptions(target, { store }) {
  return {
    entryPoints: { background: "src/background/index.ts", popup: "src/popup/popup.ts" },
    bundle: true,
    format: "iife",
    target: ESBUILD_TARGET[target],
    // addons.mozilla.org reviewers read the shipped code, so Firefox stays
    // unminified.
    minify: store && target !== "firefox",
    sourcemap: store ? false : "linked",
    legalComments: "none",
    logLevel: "warning",
  };
}
