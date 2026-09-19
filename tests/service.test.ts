import { describe, expect, it, vi } from "vitest";
import { ClientError } from "../src/background/native-client";
import { fillableOrigin } from "../src/background/origin";
import type { RequestBody } from "../src/background/protocol";
import { Service, TEXT } from "../src/background/service";
import { isAtLeast } from "../src/background/version";
import type { FillArgs, FillResult } from "../src/page/fill-page";

type Answer = Record<string, unknown> | ClientError;

function setup(answers: Partial<Record<RequestBody["type"], Answer>>, url = "https://github.com/login") {
  const requests: RequestBody[] = [];
  const pageCalls: FillArgs[] = [];
  const flags: boolean[] = [];
  let pageResult: (args: FillArgs) => FillResult = (args) =>
    args.fill ? { outcome: "filled", usernameFilled: true } : { outcome: "ready" };
  const service = new Service({
    client: {
      request: async (body: RequestBody) => {
        requests.push(body);
        const answer = answers[body.type];
        if (answer instanceof ClientError) throw answer;
        if (!answer) throw new ClientError("timeout");
        return { id: "1", type: body.type, ...answer };
      },
    },
    tabUrl: async () => url,
    runInPage: async (_tabId, args) => {
      pageCalls.push(structuredClone(args));
      return pageResult(args);
    },
    flag: (_tabId, on) => flags.push(on),
  });
  return {
    service,
    requests,
    pageCalls,
    flags,
    setPage: (fn: typeof pageResult) => (pageResult = fn),
  };
}

const unlocked = { state: "unlocked", silo: "Personal", version: "1.2.0" };
const githubLogins = { logins: [{ ref: "r1", label: "GitHub", username: "alex@example.com" }] };

describe("opening the popup", () => {
  it("asks for status, then the logins for the tab's own origin", async () => {
    const { service, requests } = setup({ status: unlocked, logins: githubLogins });
    const view = await service.open(7);
    expect(requests).toEqual([{ type: "status" }, { type: "logins", origin: "https://github.com" }]);
    expect(view).toEqual({
      state: "ready",
      site: "github.com",
      silo: "Personal",
      logins: githubLogins.logins,
      waiting: false,
      notice: undefined,
    });
  });

  it.each([
    ["locked", { state: "locked", version: "1.2.0" }, "locked"],
    ["no-silo", { state: "no-silo", version: "1.2.0" }, "no-silo"],
  ])("shows %s from the status answer", async (_name, status, state) => {
    const { service, requests } = setup({ status });
    expect((await service.open(1)).state).toBe(state);
    expect(requests).toHaveLength(1);
  });

  it.each([["app-not-running"], ["no-host"], ["locked"], ["no-silo"]])("shows %s from an error", async (code) => {
    const { service } = setup({ status: new ClientError(code) });
    expect((await service.open(1)).state).toBe(code);
  });

  it("asks for an update below 1.2.0, and asks nothing more", async () => {
    const { service, requests } = setup({ status: { state: "unlocked", version: "1.1.0" } });
    expect(await service.open(1)).toEqual({ state: "update", version: "1.1.0", required: "1.2.0" });
    expect(requests).toHaveLength(1);
  });

  it("does not send an address the protocol does not allow", async () => {
    for (const url of ["http://example.com/", "chrome://settings", "file:///C:/a.html", ""]) {
      const { service, requests } = setup({ status: unlocked }, url);
      expect((await service.open(1)).state).toBe("unsupported-page");
      expect(requests).toHaveLength(0);
    }
  });

  it("shows a timeout in words", async () => {
    const { service } = setup({});
    expect(await service.open(1)).toEqual({ state: "error", message: TEXT.timeout });
  });

  it("rejects a logins answer of the wrong shape", async () => {
    const { service } = setup({ status: unlocked, logins: { logins: [{ label: "no ref" }] } });
    expect(await service.open(1)).toEqual({ state: "error", message: TEXT.badAnswer });
  });
});

describe("search", () => {
  it("sends the trimmed query and returns at most 20 results", async () => {
    const many = Array.from({ length: 30 }, (_, i) => ({ ref: `r${i}`, label: `Bank ${i}`, username: "" }));
    const { service, requests } = setup({ search: { logins: many } });
    const result = await service.search("  bank ");
    expect(requests).toEqual([{ type: "search", query: "bank" }]);
    expect(result.state === "results" && result.logins.length).toBe(20);
  });

  it("keeps the site each result was saved for", async () => {
    const { service } = setup({
      search: { logins: [{ ref: "r1", label: "Bank", username: "", site: "bank.example" }, { ref: "r2", label: "X" }] },
    });
    expect(await service.search("ba")).toEqual({
      state: "results",
      logins: [
        { ref: "r1", label: "Bank", username: "", site: "bank.example" },
        { ref: "r2", label: "X", username: "" },
      ],
    });
  });

  it("sends nothing for an empty query", async () => {
    const { service, requests } = setup({});
    expect(await service.search("   ")).toEqual({ state: "results", logins: [] });
    expect(requests).toHaveLength(0);
  });

  it("sends nothing under two characters, counted after trimming", async () => {
    const { service, requests } = setup({ search: { logins: [] } });
    expect(await service.search(" b ")).toEqual({ state: "results", logins: [] });
    // One character, two UTF-16 units.
    expect(await service.search(String.fromCodePoint(0x1f511))).toEqual({ state: "results", logins: [] });
    expect(requests).toHaveLength(0);
    await service.search("ba");
    expect(requests).toEqual([{ type: "search", query: "ba" }]);
  });

  it("shows busy in general terms", async () => {
    const { service } = setup({ search: new ClientError("busy") });
    expect(await service.search("bank")).toEqual({ state: "error", message: TEXT.busy });
    expect(TEXT.busy).toBe("SilentSilo is busy. Try again in a few seconds.");
  });
});

describe("show", () => {
  it("sends show and nothing else", async () => {
    const { service, requests } = setup({ show: {} });
    expect(await service.show()).toEqual({ state: "shown" });
    expect(requests).toEqual([{ type: "show" }]);
  });

  it("shows busy in general terms", async () => {
    const { service } = setup({ show: new ClientError("busy") });
    expect(await service.show()).toEqual({ state: "error", message: TEXT.busy });
  });

  it("shows an app that stopped as not running", async () => {
    const { service } = setup({ show: new ClientError("app-not-running") });
    expect(await service.show()).toEqual({ state: "app-not-running" });
  });
});

describe("fill", () => {
  it("checks the page, asks the app, then writes into the page for the same origin", async () => {
    const { service, requests, pageCalls } = setup({
      fill: { username: "alex@example.com", password: "hunter2" },
    });
    expect(await service.fill(3, "r1")).toEqual({ ok: true, usernameFilled: true });
    expect(requests).toEqual([{ type: "fill", origin: "https://github.com", ref: "r1" }]);
    expect(pageCalls).toEqual([
      { expectedOrigin: "https://github.com", fill: null },
      { expectedOrigin: "https://github.com", fill: { username: "alex@example.com", password: "hunter2" } },
    ]);
  });

  it("does not ask the app when the page has no password field", async () => {
    const { service, requests, setPage, flags } = setup({});
    setPage(() => ({ outcome: "no-password", crossOriginFrame: false }));
    expect(await service.fill(3, "r1")).toEqual({ ok: false, message: TEXT.noPassword });
    expect(requests).toHaveLength(0);
    expect(flags).toEqual([true]);
  });

  it("says so when the form is in a frame from another site", async () => {
    const { service, setPage } = setup({});
    setPage(() => ({ outcome: "no-password", crossOriginFrame: true }));
    expect(await service.fill(3, "r1")).toEqual({ ok: false, message: TEXT.crossOriginFrame });
  });

  it("writes nothing when the tab navigated during the confirmation", async () => {
    const { service, setPage } = setup({ fill: { username: "u", password: "p" } });
    setPage((args) => (args.fill ? { outcome: "wrong-origin" } : { outcome: "ready" }));
    expect(await service.fill(3, "r1")).toEqual({ ok: false, message: TEXT.navigated });
  });

  it("says in its own words that the person declined", async () => {
    const { service } = setup({ fill: new ClientError("cancelled") });
    const result = await service.fill(3, "r1");
    expect(result).toMatchObject({ ok: false, message: TEXT.cancelled });
  });

  it("keeps the outcome for the next popup, once, when the popup closed meanwhile", async () => {
    const { service } = setup({
      status: unlocked,
      logins: githubLogins,
      fill: new ClientError("cancelled"),
    });
    await service.fill(3, "r1");
    expect(await service.open(3)).toMatchObject({ notice: TEXT.cancelled });
    expect(await service.open(3)).toMatchObject({ notice: undefined });
  });

  it("reports a fill waiting for confirmation to a reopened popup", async () => {
    let answer: (value: Record<string, unknown>) => void = () => {};
    const request = vi.fn(async (body: RequestBody) => {
      if (body.type === "status") return { id: "1", type: "status", ...unlocked };
      if (body.type === "logins") return { id: "2", type: "logins", logins: [] };
      return new Promise<Record<string, unknown>>((resolve) => (answer = resolve));
    });
    const service = new Service({
      client: { request },
      tabUrl: async () => "https://github.com/",
      runInPage: async (_tab, args) => (args.fill ? { outcome: "filled", usernameFilled: true } : { outcome: "ready" }),
      flag: () => {},
    });
    const fill = service.fill(3, "r1");
    await vi.waitFor(() => expect(request).toHaveBeenCalledTimes(1));
    expect(await service.open(3)).toMatchObject({ waiting: true });
    expect(await service.open(4)).toMatchObject({ waiting: false });
    answer({ id: "3", type: "fill", username: "u", password: "p" });
    expect(await fill).toEqual({ ok: true, usernameFilled: true });
    expect(await service.open(3)).toMatchObject({ waiting: false });
  });

  it("rejects a fill answer without strings", async () => {
    const { service, pageCalls } = setup({ fill: { username: "u" } });
    expect(await service.fill(3, "r1")).toEqual({ ok: false, message: TEXT.badAnswer });
    expect(pageCalls).toHaveLength(1);
  });
});

describe("origins", () => {
  it.each([
    ["https://github.com/login?x=1", "https://github.com"],
    ["https://bank.example:8443/", "https://bank.example:8443"],
    ["http://localhost:3000/", "http://localhost:3000"],
    ["http://127.0.0.1/", "http://127.0.0.1"],
    ["http://[::1]:8080/", "http://[::1]:8080"],
    ["http://example.com/", null],
    ["http://localhost.example.com/", null],
    ["ftp://github.com/", null],
    ["chrome-extension://abc/popup.html", null],
    ["not a url", null],
  ])("%s -> %s", (url, origin) => {
    expect(fillableOrigin(url)).toBe(origin);
  });
});

describe("versions", () => {
  it.each([
    ["1.2.0", true],
    ["1.2.1", true],
    ["1.10.0", true],
    ["2.0.0", true],
    ["1.2.0-rc.1", true],
    ["1.1.9", false],
    ["0.9.0", false],
    ["", false],
    ["garbage", false],
  ])("%s speaks the protocol: %s", (version, ok) => {
    expect(isAtLeast(version, "1.2.0")).toBe(ok);
  });
});
