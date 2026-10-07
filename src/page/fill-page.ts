// The only code that runs inside a page. chrome.scripting serializes this one
// function and runs it in the top frame of the active tab, so it must not
// refer to anything outside its own body.
//
// It looks at the page's input fields and nothing else: their type, whether
// they can be seen, and which form they belong to. It reads what is typed
// in them only with `read` set, on the person's click on "Save this login",
// and then only the password field and the username field before it; never
// any other text on the page. When the top frame has no password field it
// checks whether a frame holds one, and fills nothing there. With `fill` set
// it writes the two values and returns; without either, it only reports
// whether it could.

export interface FillArgs {
  // The origin the person confirmed. A page that navigated since gets nothing.
  expectedOrigin: string;
  fill: { username: string; password: string } | null;
  // Return what is typed in the login form instead of writing to it.
  read?: boolean;
}

export type FillResult =
  | { outcome: "wrong-origin" }
  // `frame`: where a login form this function cannot reach seems to be.
  | { outcome: "no-password"; frame: "this-site" | "other-site" | null }
  // Every usable password field is in a form that sends to another site.
  // `host` names it, empty when the address is not a web one.
  | { outcome: "elsewhere"; host: string }
  | { outcome: "ready" }
  | { outcome: "filled"; usernameFilled: boolean }
  // What the person typed, for saving. `username` may be empty.
  | { outcome: "read"; username: string; password: string }
  // Different passwords typed in several fields, and none of them is the
  // one the person is in: which to save cannot be told.
  | { outcome: "several" };

export function fillPage(args: FillArgs): FillResult {
  if (location.origin !== args.expectedOrigin) return { outcome: "wrong-origin" };

  // Read through the prototypes, never the element: a form's named controls
  // shadow its own properties, and the document's named images and forms
  // shadow the document's. An input named "elements" hid every button of its
  // form from the check below. A getter that is missing throws, and nothing
  // is filled.
  function getter(proto: object, name: string): (this: unknown) => unknown {
    const get = Object.getOwnPropertyDescriptor(proto, name)?.get;
    if (!get) throw new Error(`no ${name}`);
    return get;
  }
  const formElements = getter(HTMLFormElement.prototype, "elements");
  const rootElement = getter(Document.prototype, "documentElement");
  const baseURI = getter(Node.prototype, "baseURI");
  const hasAttribute = Element.prototype.hasAttribute;
  const getAttribute = Element.prototype.getAttribute;

  // Where a form sends, as the browser works it out: an empty address is
  // the page itself, anything else is read against the document's base,
  // which a planted `<base href>` sets. Read against `location`, a relative
  // address looked like this site whatever the base said.
  function sentTo(element: Element, attribute: string): string {
    const address = getAttribute.call(element, attribute) ?? "";
    if (address.trim() === "") return location.href;
    try {
      return new URL(address, String(baseURI.call(document))).href;
    } catch {
      return address;
    }
  }

  function hiddenByStyle(element: Element): boolean {
    for (let node: Element | null = element; node; node = parentElement(node)) {
      if (node.hasAttribute("hidden") || node.hasAttribute("inert")) return true;
      if (node.getAttribute("aria-hidden") === "true") return true;
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
    if (hiddenByStyle(element)) return false;
    const style = getComputedStyle(element);
    if (parseFloat(style.width) <= 1 || parseFloat(style.height) <= 1) return false;
    if (style.position === "absolute" || style.position === "fixed") {
      if (parseFloat(style.left) <= -500 || parseFloat(style.top) <= -500) return false;
    }
    if (hasLayout) {
      const rect = element.getBoundingClientRect();
      if (rect.width <= 1 || rect.height <= 1) return false;
      if (rect.right + scrollX <= 0 || rect.bottom + scrollY <= 0) return false;
      const page = rootElement.call(document) as HTMLElement;
      if (rect.left + scrollX >= Math.max(page.scrollWidth, innerWidth)) return false;
      if (rect.top + scrollY >= Math.max(page.scrollHeight, innerHeight)) return false;
      if (!onTop(element, rect)) return false;
    }
    return true;
  }

  // Something laid over the field, or a clip, means the person sees
  // something else where it is. Tested at a few points, only those on screen;
  // a field scrolled out of view is judged by the checks above.
  function onTop(element: HTMLElement, rect: DOMRect): boolean {
    const root = element.getRootNode() as Document | ShadowRoot;
    if (typeof root.elementFromPoint !== "function") return true;
    let tested = false;
    for (const [fx, fy] of [[0.5, 0.5], [0.2, 0.5], [0.8, 0.5], [0.5, 0.25], [0.5, 0.75]]) {
      const x = rect.left + rect.width * fx;
      const y = rect.top + rect.height * fy;
      if (x < 0 || y < 0 || x >= innerWidth || y >= innerHeight) continue;
      tested = true;
      const hit = root.elementFromPoint(x, y);
      if (!hit) continue;
      if (hit === element || element.contains(hit)) return true;
      // A floating label drawn over its own field.
      const label = hit.closest("label");
      if (label instanceof HTMLLabelElement && label.control === element) return true;
    }
    return !tested;
  }

  // Where a field's form sends what is typed in it: the form's action, and
  // the formaction of any of its buttons. Someone who can post markup on the
  // right site, but not scripts, can take a password only by planting a
  // form that sends it to another. Returns that other place, or null.
  function sendsElsewhere(input: HTMLInputElement): string | null {
    const form = input.form;
    if (!form) return null;
    const targets: string[] = [];
    if (hasAttribute.call(form, "action")) targets.push(sentTo(form, "action"));
    for (const element of Array.from(formElements.call(form) as HTMLFormControlsCollection)) {
      if (
        (element instanceof HTMLButtonElement || element instanceof HTMLInputElement) &&
        hasAttribute.call(element, "formaction")
      ) {
        targets.push(sentTo(element, "formaction"));
      }
    }
    for (const target of targets) {
      const host = foreignHost(target);
      if (host !== null) return host;
    }
    return null;
  }

  // This site, one of its subdomains, or a domain it is under: the same
  // owner. Anything else, a script address included, is another site.
  function foreignHost(address: string): string | null {
    let url: URL;
    try {
      url = new URL(address, location.href);
    } catch {
      return "";
    }
    if (url.protocol !== "https:" && url.protocol !== location.protocol) {
      return url.protocol === "http:" ? url.host : "";
    }
    const here = location.hostname;
    const there = url.hostname;
    if (there === here || there.endsWith(`.${here}`) || here.endsWith(`.${there}`)) return null;
    return url.host;
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

  // The text or email field before the password, in the same form, or before
  // it on the page when there is no form.
  function usernameBefore(password: HTMLInputElement): HTMLInputElement | undefined {
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
    return (
      before.find((input) => wants(input, "username")) ??
      before.find((input) => wants(input, "email")) ??
      before[before.length - 1]
    );
  }

  const inputs = allInputs(document);
  // Whether the browser laid the page out at all. Not the root element's
  // width, which the page's own style can set to zero.
  const hasLayout = inputs.some((input) => {
    const rect = input.getBoundingClientRect();
    return rect.width > 0 || rect.height > 0;
  });
  const passwords = inputs.filter((input) => input.type === "password" && usable(input));

  // Saving reads what the person typed, wherever the form sends it: the
  // values go to the app, not to the form. The field they are in, or the
  // first that holds something.
  if (args.read) {
    // A field a "show password" button turned into text still says what it
    // is for when the page marks it.
    const shown = inputs.filter(
      (input) =>
        input.type === "text" &&
        usable(input) &&
        (wants(input, "current-password") || wants(input, "new-password")),
    );
    const typed = [...passwords, ...shown].filter((input) => input.value !== "");
    const focused = typed.find((input) => document.activeElement === input);
    // Several different values and none the person is in: one of them may
    // be a field the page put there, so nothing is guessed. A new password
    // typed twice is one value.
    if (!focused && new Set(typed.map((input) => input.value)).size > 1) {
      return { outcome: "several" };
    }
    const chosen = focused ?? typed[0];
    if (!chosen) return { outcome: "no-password", frame: null };
    const named = usernameBefore(chosen);
    return { outcome: "read", username: named?.value.trim() ?? "", password: chosen.value };
  }

  const staying = passwords.filter((input) => sendsElsewhere(input) === null);
  const password = staying.find((input) => wants(input, "current-password")) ?? staying[0];

  if (!password && passwords.length > 0) {
    const first = passwords.find((input) => wants(input, "current-password")) ?? passwords[0];
    return { outcome: "elsewhere", host: sendsElsewhere(first) ?? "" };
  }

  if (!password) {
    // A frame this page can open (same origin, srcdoc, about:blank) is
    // looked into for a password field only; one from another site is
    // judged by its address.
    let thisSite = false;
    let otherSite = false;
    for (const frame of document.querySelectorAll("iframe, frame")) {
      if (!(frame instanceof HTMLElement) || !isVisible(frame)) continue;
      let inner: Document | null;
      try {
        inner = (frame as HTMLIFrameElement).contentDocument;
      } catch {
        inner = null;
      }
      if (inner?.querySelector("input[type=password]")) {
        thisSite = true;
        continue;
      }
      const src = frame.getAttribute("src");
      if (!src) continue;
      try {
        if (new URL(src, location.href).origin !== location.origin) otherSite = true;
      } catch {
        // Not an address: nothing to say about it.
      }
    }
    return { outcome: "no-password", frame: thisSite ? "this-site" : otherSite ? "other-site" : null };
  }

  const username = usernameBefore(password);

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
