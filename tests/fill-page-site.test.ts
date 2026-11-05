// @vitest-environment jsdom
// @vitest-environment-options { "url": "https://www.gmx.com/" }
import { afterEach, describe, expect, it } from "vitest";
import { fillPage } from "../src/page/fill-page";
import { siteOf } from "../src/shared/site";

// A page on www.gmx.com, whose login form posts to login.gmx.com.
const creds = { username: "alex@gmx.com", password: "hunter2" };

function fill(site = siteOf(location.hostname)) {
  return fillPage({ expectedOrigin: location.origin, site, fill: creds });
}

function form(action: string): void {
  document.body.innerHTML = `<form action="${action}"><input name="u"><input name="p" type="password"></form>`;
}

function password(): string {
  return (document.querySelector("[name=p]") as HTMLInputElement).value;
}

afterEach(() => {
  document.body.innerHTML = "";
});

describe("a form that sends elsewhere on the same site", () => {
  it.each(["https://login.gmx.com/login", "https://gmx.com/login", "https://a.b.gmx.com/x"])("fills for %s", (action) => {
    expect(location.hostname).toBe("www.gmx.com");
    form(action);
    expect(fill()).toEqual({ outcome: "filled", usernameFilled: true });
    expect(password()).toBe(creds.password);
  });

  it.each([
    ["https://gmx.com.evil.example/login", "gmx.com.evil.example"],
    ["https://evilgmx.com/login", "evilgmx.com"],
    ["https://gmx.net/login", "gmx.net"],
    ["https://com/login", "com"],
  ])("refuses %s", (action, host) => {
    form(action);
    expect(fill()).toEqual({ outcome: "elsewhere", host });
    expect(password()).toBe("");
  });

  it("falls back to the page's own host when told a site it is not under", () => {
    form("https://login.gmx.com/login");
    expect(fill("example.com")).toEqual({ outcome: "elsewhere", host: "login.gmx.com" });
    expect(password()).toBe("");
  });
});

describe("the site of a host", () => {
  it.each([
    ["www.gmx.com", "gmx.com"],
    ["login.gmx.com", "gmx.com"],
    ["a.b.example.co.uk", "example.co.uk"],
    ["alice.github.io", "alice.github.io"],
    ["github.io", "github.io"],
    ["host.intranet", "host.intranet"],
    ["localhost", "localhost"],
    ["127.0.0.1", "127.0.0.1"],
    ["[::1]", "[::1]"],
  ])("%s is %s", (host, site) => {
    expect(siteOf(host)).toBe(site);
  });
});
