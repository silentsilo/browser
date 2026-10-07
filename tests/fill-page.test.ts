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
    `<div aria-hidden="true"><input class="d" type="password"></div>`,
    `<div inert><input class="d" type="password"></div>`,
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

describe("where the form sends it", () => {
  const stays = [
    `<form>`,
    `<form action="">`,
    `<form action="/session">`,
    `<form action="https://sso.${location.hostname}/login">`,
    `<form action="${location.origin}/login"><button formaction="/other">Go</button>`,
  ];

  it.each(stays)("fills %s", (open) => {
    page(`${open}<input name="u"><input name="p" type="password"></form>`);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: true });
    expect(value("[name=p]")).toBe(creds.password);
  });

  it("refuses a form that sends to another site, and names it", () => {
    page(`<form action="https://collect.example/steal"><input name="u"><input name="p" type="password"></form>`);
    expect(fill()).toEqual({ outcome: "elsewhere", host: "collect.example" });
    expect(value("[name=u]")).toBe("");
    expect(value("[name=p]")).toBe("");
  });

  it("refuses a form whose button sends to another site", () => {
    page(`<form><input name="u"><input name="p" type="password">
          <button formaction="https://collect.example/steal">Sign in</button></form>`);
    expect(fill()).toEqual({ outcome: "elsewhere", host: "collect.example" });
    expect(value("[name=p]")).toBe("");
  });

  it("reads a relative address against a planted <base>, as the browser sends it", () => {
    // Resolved against the page's address, "/login" looked like this site.
    const base = document.createElement("base");
    base.href = "https://collect.example/";
    document.head.append(base);
    try {
      page(`<form action="/login"><input name="u"><input name="p" type="password"></form>`);
      expect(fill()).toEqual({ outcome: "elsewhere", host: "collect.example" });
      expect(value("[name=p]")).toBe("");
    } finally {
      base.remove();
    }
  });

  it("refuses a button outside the form that belongs to it", () => {
    page(`<form id="login"><input name="u"><input name="p" type="password"></form>
          <button form="login" formaction="https://collect.example/c">Sign in</button>`);
    expect(fill()).toEqual({ outcome: "elsewhere", host: "collect.example" });
  });

  it("counts a script address as another site", () => {
    page(`<form action="javascript:void(0)"><input name="p" type="password"></form>`);
    expect(fill()).toEqual({ outcome: "elsewhere", host: "" });
  });

  it("does not take a site that merely ends the same way", () => {
    page(`<form action="https://evil${location.hostname}/x"><input name="p" type="password"></form>`);
    expect(fill().outcome).toBe("elsewhere");
  });

  it("fills the form that stays over a planted one marked current-password", () => {
    page(`<form action="https://collect.example/steal"><input name="trap" type="password" autocomplete="current-password"></form>
          <form><input name="u"><input name="real" type="password"></form>`);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: true });
    expect(value("[name=trap]")).toBe("");
    expect(value("[name=real]")).toBe(creds.password);
  });

  it("only reports, without values, the same way", () => {
    page(`<form action="https://collect.example/steal"><input name="p" type="password"></form>`);
    expect(fillPage({ expectedOrigin: location.origin, fill: null })).toEqual({
      outcome: "elsewhere",
      host: "collect.example",
    });
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

describe("reading for a save", () => {
  function read() {
    return fillPage({ expectedOrigin: location.origin, fill: null, read: true });
  }

  function type(selector: string, text: string): void {
    (document.querySelector(selector) as HTMLInputElement).value = text;
  }

  it("reads the typed password and the username before it", () => {
    page(`<form><input name="u"><input name="p" type="password"></form>`);
    type("[name=u]", "  alex@example.com ");
    type("[name=p]", "hunter2");
    expect(read()).toEqual({ outcome: "read", username: "alex@example.com", password: "hunter2" });
  });

  it("reads a password alone, as on the second step of a sign-in", () => {
    page(`<form><input name="p" type="password"></form>`);
    type("[name=p]", "hunter2");
    expect(read()).toEqual({ outcome: "read", username: "", password: "hunter2" });
  });

  it("reads whatever the form sends to: the values go to the app", () => {
    page(`<form action="https://sso.example.net/login"><input name="u"><input name="p" type="password"></form>`);
    type("[name=u]", "alex");
    type("[name=p]", "hunter2");
    expect(read()).toEqual({ outcome: "read", username: "alex", password: "hunter2" });
  });

  it("takes the field the person is in", () => {
    page(`<form><input name="old" type="password" autocomplete="current-password">
          <input name="new" type="password" autocomplete="new-password"></form>`);
    type("[name=old]", "old-one");
    type("[name=new]", "new-one");
    (document.querySelector("[name=new]") as HTMLInputElement).focus();
    expect(read()).toMatchObject({ password: "new-one" });
  });

  it("asks which when different passwords are typed and none is focused", () => {
    // One of them may be a field the page planted: nothing is guessed.
    page(`<form><input name="a" type="password"><input name="new" type="password" autocomplete="new-password">
          <input name="cur" type="password" autocomplete="current-password"></form>`);
    type("[name=a]", "first");
    type("[name=new]", "new-one");
    type("[name=cur]", "current");
    expect(read()).toEqual({ outcome: "several" });
  });

  it("reads a new password typed twice as the one it is", () => {
    page(`<form><input name="new" type="password" autocomplete="new-password">
          <input name="again" type="password" autocomplete="new-password"></form>`);
    type("[name=new]", "new-one");
    type("[name=again]", "new-one");
    expect(read()).toMatchObject({ outcome: "read", password: "new-one" });
  });

  it("reads a field the page's show-password button turned into text", () => {
    page(`<form><input name="u"><input name="p" type="text" autocomplete="current-password"></form>`);
    type("[name=u]", "alex");
    type("[name=p]", "hunter2");
    expect(read()).toEqual({ outcome: "read", username: "alex", password: "hunter2" });
  });

  it("skips an empty password field for one that holds a value", () => {
    page(`<form><input name="a" type="password"></form><form><input name="b" type="password"></form>`);
    type("[name=b]", "typed");
    expect(read()).toMatchObject({ password: "typed" });
  });

  it("reports no password when nothing is typed", () => {
    page(`<form><input name="u"><input name="p" type="password"></form>`);
    type("[name=u]", "alex");
    expect(read()).toEqual({ outcome: "no-password", frame: null });
  });

  it("skips a hidden field that holds a value", () => {
    page(`<form><input name="u"><input class="d" type="password" style="display:none" value="planted">
          <input name="p" type="password"></form>`);
    expect(read()).toEqual({ outcome: "no-password", frame: null });
    type("[name=p]", "hunter2");
    expect(read()).toMatchObject({ password: "hunter2" });
  });

  it("reads nothing on another origin", () => {
    page(`<form><input name="p" type="password"></form>`);
    type("[name=p]", "hunter2");
    expect(fillPage({ expectedOrigin: "https://github.com", fill: null, read: true })).toEqual({
      outcome: "wrong-origin",
    });
  });

  it("changes nothing in the page", () => {
    page(`<form id="f"><input name="u"><input name="p" type="password"></form>`);
    type("[name=u]", "alex");
    type("[name=p]", "hunter2");
    const before = document.body.innerHTML;
    read();
    expect(document.body.innerHTML).toBe(before);
    expect(value("[name=p]")).toBe("hunter2");
  });
});
