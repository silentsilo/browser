// The only code that runs inside a page. chrome.scripting serializes this one
// function and runs it in the top frame of the active tab, so it must not
// refer to anything outside its own body.
//
// It looks at the page's input fields and nothing else: their type, whether
// they can be seen, and which form they belong to. It never reads what is
// typed in them or any other text on the page. With `fill` set it writes the
// two values and returns; without it, it only reports whether it could.

export interface FillArgs {
  // The origin the person confirmed. A page that navigated since gets nothing.
  expectedOrigin: string;
  fill: { username: string; password: string } | null;
}

export type FillResult =
  | { outcome: "wrong-origin" }
  | { outcome: "no-password"; crossOriginFrame: boolean }
  | { outcome: "ready" }
  | { outcome: "filled"; usernameFilled: boolean };

export function fillPage(args: FillArgs): FillResult {
  if (location.origin !== args.expectedOrigin) return { outcome: "wrong-origin" };

  const hasLayout = document.documentElement.getBoundingClientRect().width > 0;

  function hiddenByStyle(element: Element): boolean {
    for (let node: Element | null = element; node; node = parentElement(node)) {
      if (node.hasAttribute("hidden")) return true;
      const style = getComputedStyle(node);
      if (style.display === "none") return true;
      if (style.visibility === "hidden" || style.visibility === "collapse") return true;
      if (parseFloat(style.opacity) === 0) return true;
    }
    return false;
  }

  // Parent across shadow root boundaries.
  function parentElement(node: Element): Element | null {
    if (node.parentElement) return node.parentElement;
    const root = node.getRootNode();
    return root instanceof ShadowRoot ? root.host : null;
  }

  // Decoy fields, the kind put there to catch bots or other fillers, are
  // hidden in a handful of ways. Skip every one of them.
  function isVisible(element: HTMLElement): boolean {
    if (element.getAttribute("aria-hidden") === "true") return false;
    if (hiddenByStyle(element)) return false;
    const style = getComputedStyle(element);
    if (parseFloat(style.width) <= 1 || parseFloat(style.height) <= 1) return false;
    if (style.position === "absolute" || style.position === "fixed") {
      if (parseFloat(style.left) <= -500 || parseFloat(style.top) <= -500) return false;
    }
    if (hasLayout) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      if (rect.right <= 0 || rect.bottom <= 0) return false;
    }
    return true;
  }

  function usable(input: HTMLInputElement): boolean {
    return !input.disabled && !input.readOnly && isVisible(input);
  }

  function allInputs(root: Document | ShadowRoot, found: HTMLInputElement[] = []): HTMLInputElement[] {
    for (const element of root.querySelectorAll("*")) {
      if (element instanceof HTMLInputElement) found.push(element);
      if (element.shadowRoot) allInputs(element.shadowRoot, found);
    }
    return found;
  }

  function wants(input: HTMLInputElement, token: string): boolean {
    return (input.getAttribute("autocomplete") ?? "").toLowerCase().split(/\s+/).includes(token);
  }

  const inputs = allInputs(document);
  const passwords = inputs.filter((input) => input.type === "password" && usable(input));
  const password = passwords.find((input) => wants(input, "current-password")) ?? passwords[0];

  if (!password) {
    const crossOriginFrame = [...document.querySelectorAll("iframe, frame")].some((frame) => {
      const src = frame.getAttribute("src");
      if (!src || !(frame instanceof HTMLElement) || !isVisible(frame)) return false;
      try {
        return new URL(src, location.href).origin !== location.origin;
      } catch {
        return false;
      }
    });
    return { outcome: "no-password", crossOriginFrame };
  }

  // The text or email field before the password, in the same form, or before
  // it on the page when there is no form.
  const textTypes = ["text", "email", "tel"];
  const root = password.getRootNode();
  const before = inputs.filter(
    (input) =>
      input.getRootNode() === root &&
      input.form === password.form &&
      textTypes.includes(input.type) &&
      !input.closest("[role=search]") &&
      usable(input) &&
      (input.compareDocumentPosition(password) & Node.DOCUMENT_POSITION_FOLLOWING) !== 0,
  );
  const username =
    before.find((input) => wants(input, "username")) ??
    before.find((input) => wants(input, "email")) ??
    before[before.length - 1];

  if (!args.fill) return { outcome: "ready" };

  // The native setter, then input and change, so React, Vue and Angular
  // notice the new value the way they notice typing.
  const setValue = Object.getOwnPropertyDescriptor(HTMLInputElement.prototype, "value")?.set;
  function write(input: HTMLInputElement, value: string): void {
    if (setValue) setValue.call(input, value);
    else input.value = value;
    input.dispatchEvent(new Event("input", { bubbles: true, composed: true }));
    input.dispatchEvent(new Event("change", { bubbles: true }));
  }

  if (username) write(username, args.fill.username);
  write(password, args.fill.password);
  return { outcome: "filled", usernameFilled: username !== undefined };
}
