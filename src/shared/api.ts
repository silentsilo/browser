// The extension API. Firefox's `browser` returns promises from every call;
// its `chrome` alias is the one that may not, so it is used only where
// `browser` is missing, as in Chrome.
export const api: typeof chrome = (globalThis as { browser?: typeof chrome }).browser ?? chrome;
