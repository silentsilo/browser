// @vitest-environment jsdom
import { createElement, useState, act } from "react";
import { createRoot, type Root } from "react-dom/client";
import { afterEach, describe, expect, it } from "vitest";
import { fillPage } from "../src/page/fill-page";

const creds = { username: "alex@example.com", password: "hunter2" };

function page(html: string): void {
  document.body.innerHTML = html;
}

function fill() {
  return fillPage({ expectedOrigin: location.origin, fill: creds });
}

function value(selector: string): string {
  return (document.querySelector(selector) as HTMLInputElement).value;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("finding the fields", () => {
  it("fills a plain form", () => {
    page(`<form><input name="user" type="text"><input name="pass" type="password"><button>Sign in</button></form>`);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: true });
    expect(value("[name=user]")).toBe(creds.username);
    expect(value("[name=pass]")).toBe(creds.password);
  });

  it("fills an email field before the password, and an input with no type", () => {
    page(`<form><input name="email" type="email"><input name="pass" type="password"></form>
          <form><input name="plain"><input name="pass2" type="password"></form>`);
    fill();
    expect(value("[name=email]")).toBe(creds.username);
    expect(value("[name=plain]")).toBe("");
  });

  it("takes the text field nearest before the password, not one after it", () => {
    page(`<form><input name="first"><input name="login"><input name="pass" type="password"><input name="after"></form>`);
    fill();
    expect(value("[name=first]")).toBe("");
    expect(value("[name=login]")).toBe(creds.username);
    expect(value("[name=after]")).toBe("");
  });

  it("prefers the field marked autocomplete=username", () => {
    page(`<form><input name="login" autocomplete="username"><input name="other"><input name="pass" type="password"></form>`);
    fill();
    expect(value("[name=login]")).toBe(creds.username);
    expect(value("[name=other]")).toBe("");
  });

  it("stays in the password's form", () => {
    page(`<form><input name="newsletter" type="email"></form>
          <form><input name="pass" type="password"></form>`);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: false });
    expect(value("[name=newsletter]")).toBe("");
    expect(value("[name=pass]")).toBe(creds.password);
  });

  it("fills the password alone when there is no username field", () => {
    page(`<form><input name="pass" type="password"></form>`);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: false });
    expect(value("[name=pass]")).toBe(creds.password);
  });

  it("works without a form element", () => {
    page(`<div><input id="u" type="email"><input id="p" type="password"></div>`);
    fill();
    expect(value("#u")).toBe(creds.username);
    expect(value("#p")).toBe(creds.password);
  });

  it("prefers the current-password field on a change-password page", () => {
    page(`<form><input name="u">
          <input name="new" type="password" autocomplete="new-password">
          <input name="cur" type="password" autocomplete="current-password"></form>`);
    fill();
    expect(value("[name=cur]")).toBe(creds.password);
    expect(value("[name=new]")).toBe("");
  });

  it("skips a site search box", () => {
    page(`<div role="search"><input name="q"></div><input id="p" type="password">`);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: false });
    expect(value("[name=q]")).toBe("");
  });

  it("finds fields inside an open shadow root", () => {
    page(`<login-box></login-box>`);
    const shadow = (document.querySelector("login-box") as HTMLElement).attachShadow({ mode: "open" });
    shadow.innerHTML = `<form><input id="u"><input id="p" type="password"></form>`;
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: true });
    expect((shadow.getElementById("u") as HTMLInputElement).value).toBe(creds.username);
    expect((shadow.getElementById("p") as HTMLInputElement).value).toBe(creds.password);
  });
});

describe("decoys", () => {
  const decoys = [
    `<input class="d" type="password" style="display:none">`,
    `<div style="display:none"><input class="d" type="password"></div>`,
    `<input class="d" type="password" style="visibility:hidden">`,
    `<input class="d" type="password" style="opacity:0">`,
    `<input class="d" type="password" hidden>`,
    `<input class="d" type="password" aria-hidden="true">`,
    `<input class="d" type="password" style="width:0;height:0">`,
    `<input class="d" type="password" style="position:absolute;left:-9999px">`,
    `<input class="d" type="password" disabled>`,
    `<input class="d" type="password" readonly>`,
    `<input class="d" type="hidden" name="password">`,
  ];

  it.each(decoys)("skips %s", (decoy) => {
    page(`<form><input name="u">${decoy}<input name="real" type="password"></form>`);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: true });
    expect((document.querySelector(".d") as HTMLInputElement | null)?.value ?? "").not.toBe(creds.password);
    expect(value("[name=real]")).toBe(creds.password);
  });

  it("skips a hidden username decoy before the real one", () => {
    page(`<form><input name="u"><input name="trap" style="display:none"><input name="p" type="password"></form>`);
    fill();
    expect(value("[name=trap]")).toBe("");
    expect(value("[name=u]")).toBe(creds.username);
  });

  it("reports no password field when the only one is hidden", () => {
    page(`<form><input name="u"><input type="password" style="display:none"></form>`);
    expect(fill()).toEqual({ outcome: "no-password", frame: null });
    expect(value("[name=u]")).toBe("");
  });
});

describe("what it will not do", () => {
  it("writes nothing when the page is on another origin than the one confirmed", () => {
    page(`<form><input name="u"><input name="p" type="password"></form>`);
    const result = fillPage({ expectedOrigin: "https://github.com", fill: creds });
    expect(result).toEqual({ outcome: "wrong-origin" });
    expect(value("[name=u]")).toBe("");
    expect(value("[name=p]")).toBe("");
  });

  it("only reports when asked without values", () => {
    page(`<form><input name="u"><input name="p" type="password"></form>`);
    expect(fillPage({ expectedOrigin: location.origin, fill: null })).toEqual({ outcome: "ready" });
    expect(value("[name=p]")).toBe("");
  });

  it("changes nothing in the page but the two values", () => {
    page(`<form id="f" action="/login"><input name="u" class="a"><input name="p" type="password"></form>`);
    const before = document.body.innerHTML;
    fill();
    expect(document.body.innerHTML).toBe(before);
  });

  it("reports a form in a frame from another site", () => {
    page(`<iframe src="https://login.example.net/form"></iframe>`);
    expect(fill()).toEqual({ outcome: "no-password", frame: "other-site" });
  });

  it("does not blame a same-origin frame without a password field, or a hidden frame", () => {
    page(`<iframe src="/widget"></iframe><iframe src="https://ads.example.net/" style="display:none"></iframe>`);
    expect(fill()).toEqual({ outcome: "no-password", frame: null });
  });

  it("reports a form in a frame of this site, and fills nothing in it", () => {
    page(`<iframe></iframe>`);
    const inner = (document.querySelector("iframe") as HTMLIFrameElement).contentDocument as Document;
    inner.body.innerHTML = `<form><input name="u"><input name="p" type="password"></form>`;
    expect(fill()).toEqual({ outcome: "no-password", frame: "this-site" });
    expect((inner.querySelector("[name=p]") as HTMLInputElement).value).toBe("");
  });

  it("prefers a form found in a frame of this site over a frame from another", () => {
    page(`<iframe src="https://ads.example.net/"></iframe><iframe></iframe>`);
    const inner = (document.querySelectorAll("iframe")[1] as HTMLIFrameElement).contentDocument as Document;
    inner.body.innerHTML = `<input type="password">`;
    expect(fill()).toEqual({ outcome: "no-password", frame: "this-site" });
  });
});

describe("setting values the way frameworks notice", () => {
  it("fires input and change, bubbling", () => {
    page(`<form><input name="u"><input name="p" type="password"></form>`);
    const seen: string[] = [];
    document.body.addEventListener("input", (event) => seen.push(`input:${(event.target as HTMLInputElement).name}`));
    document.body.addEventListener("change", (event) => seen.push(`change:${(event.target as HTMLInputElement).name}`));
    fill();
    expect(seen).toEqual(["input:u", "change:u", "input:p", "change:p"]);
  });

  it("updates React-controlled inputs", async () => {
    (globalThis as { IS_REACT_ACT_ENVIRONMENT?: boolean }).IS_REACT_ACT_ENVIRONMENT = true;
    const state: { user: string; pass: string } = { user: "", pass: "" };

    function Login() {
      const [user, setUser] = useState("");
      const [pass, setPass] = useState("");
      state.user = user;
      state.pass = pass;
      return createElement(
        "form",
        null,
        createElement("input", { name: "u", value: user, onChange: (e: { target: HTMLInputElement }) => setUser(e.target.value) }),
        createElement("input", {
          name: "p",
          type: "password",
          value: pass,
          onChange: (e: { target: HTMLInputElement }) => setPass(e.target.value),
        }),
      );
    }

    const host = document.createElement("div");
    document.body.append(host);
    let root: Root | undefined;
    await act(async () => {
      root = createRoot(host);
      root.render(createElement(Login));
    });
    // The control: a plain assignment is invisible to React.
    await act(async () => {
      const user = document.querySelector("[name=u]") as HTMLInputElement;
      user.value = "typed";
      user.dispatchEvent(new Event("input", { bubbles: true }));
    });
    expect(state.user).toBe("");

    await act(async () => {
      fill();
    });
    expect(state).toEqual({ user: creds.username, pass: creds.password });
    expect(value("[name=u]")).toBe(creds.username);
    await act(async () => root?.unmount());
  });
});
