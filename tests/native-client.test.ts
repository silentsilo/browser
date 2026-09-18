import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ClientError, NativeClient } from "../src/background/native-client";
import { FakePort } from "./fake-port";

function setup(lastError?: string) {
  const ports: FakePort[] = [];
  const client = new NativeClient({
    connect: () => {
      const port = new FakePort();
      ports.push(port);
      return port;
    },
    lastError: () => lastError,
    idleMs: 1000,
  });
  return { client, ports };
}

async function rejection(promise: Promise<unknown>): Promise<ClientError> {
  try {
    await promise;
  } catch (error) {
    if (error instanceof ClientError) return error;
    throw error;
  }
  throw new Error("expected a rejection");
}

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("framing", () => {
  it("sends each request with its own string id and the body as given", () => {
    const { client, ports } = setup();
    void client.request({ type: "status" }, 1000);
    void client.request({ type: "logins", origin: "https://github.com" }, 1000);
    void client.request({ type: "search", query: "bank" }, 1000);
    void client.request({ type: "fill", origin: "https://github.com", ref: "c1f0" }, 1000);
    expect(ports).toHaveLength(1);
    expect(ports[0].sent).toEqual([
      { id: "1", type: "status" },
      { id: "2", type: "logins", origin: "https://github.com" },
      { id: "3", type: "search", query: "bank" },
      { id: "4", type: "fill", origin: "https://github.com", ref: "c1f0" },
    ]);
  });

  it("refuses a request over 64 KiB without sending it", async () => {
    const { client, ports } = setup();
    const error = await rejection(client.request({ type: "search", query: "x".repeat(70_000) }, 1000));
    expect(error.code).toBe("bad-request");
    expect(ports).toHaveLength(0);
  });
});

describe("answers", () => {
  it("resolves each request with the answer carrying its id, in any order", async () => {
    const { client, ports } = setup();
    const status = client.request({ type: "status" }, 1000);
    const logins = client.request({ type: "logins", origin: "https://github.com" }, 1000);
    ports[0].answer({ id: "2", type: "logins", origin: "https://github.com", logins: [] });
    ports[0].answer({ id: "1", type: "status", state: "unlocked", silo: "Personal", version: "1.2.0" });
    await expect(logins).resolves.toMatchObject({ id: "2", logins: [] });
    await expect(status).resolves.toMatchObject({ id: "1", state: "unlocked" });
  });

  it("ignores answers with an unknown id, no id, or not an object", async () => {
    const { client, ports } = setup();
    const status = client.request({ type: "status" }, 1000);
    ports[0].answer({ id: "99", type: "status", state: "locked", version: "1.2.0" });
    ports[0].answer({ type: "status", state: "locked", version: "1.2.0" });
    ports[0].answer("hello");
    ports[0].answer(null);
    ports[0].answer({ id: "1", type: "status", state: "unlocked", version: "1.2.0" });
    await expect(status).resolves.toMatchObject({ state: "unlocked" });
  });

  it("turns an error answer into a ClientError with the app's code and words", async () => {
    const { client, ports } = setup();
    const fill = client.request({ type: "fill", origin: "https://github.com", ref: "r" }, 1000);
    ports[0].answer({ id: "1", type: "error", code: "cancelled", message: "The fill was not confirmed." });
    const error = await rejection(fill);
    expect(error.code).toBe("cancelled");
    expect(error.appMessage).toBe("The fill was not confirmed.");
  });

  it("rejects an answer of the wrong type", async () => {
    const { client, ports } = setup();
    const fill = client.request({ type: "fill", origin: "https://github.com", ref: "r" }, 1000);
    ports[0].answer({ id: "1", type: "logins", logins: [] });
    expect((await rejection(fill)).code).toBe("bad-answer");
  });

  it("settles a request once: a late duplicate answer is dropped", async () => {
    const { client, ports } = setup();
    const status = client.request({ type: "status" }, 1000);
    ports[0].answer({ id: "1", type: "status", state: "locked", version: "1.2.0" });
    ports[0].answer({ id: "1", type: "status", state: "unlocked", version: "1.2.0" });
    await expect(status).resolves.toMatchObject({ state: "locked" });
  });
});

describe("timeouts", () => {
  it("rejects with timeout, and ignores the answer when it finally comes", async () => {
    const { client, ports } = setup();
    const status = client.request({ type: "status" }, 500);
    const settled = rejection(status);
    vi.advanceTimersByTime(500);
    expect((await settled).code).toBe("timeout");
    ports[0].answer({ id: "1", type: "status", state: "unlocked", version: "1.2.0" });
  });

  it("times each request out on its own clock", async () => {
    const { client, ports } = setup();
    const quick = rejection(client.request({ type: "status" }, 100));
    const fill = client.request({ type: "fill", origin: "https://github.com", ref: "r" }, 10_000);
    vi.advanceTimersByTime(100);
    expect((await quick).code).toBe("timeout");
    ports[0].answer({ id: "2", type: "fill", username: "u", password: "p" });
    await expect(fill).resolves.toMatchObject({ username: "u" });
  });
});

describe("the port closing", () => {
  it("fails every waiting request with app-not-running when the host exits", async () => {
    const { client, ports } = setup("Native host has exited.");
    const a = rejection(client.request({ type: "status" }, 1000));
    const b = rejection(client.request({ type: "logins", origin: "https://github.com" }, 1000));
    ports[0].close();
    expect((await a).code).toBe("app-not-running");
    expect((await b).code).toBe("app-not-running");
  });

  it("reports no-host when the browser cannot find the host", async () => {
    const { client, ports } = setup("Specified native messaging host not found.");
    const status = rejection(client.request({ type: "status" }, 1000));
    ports[0].close();
    expect((await status).code).toBe("no-host");
  });

  it("reports no-host when the host does not list this extension", async () => {
    const { client, ports } = setup("Access to the specified native messaging host is forbidden.");
    const status = rejection(client.request({ type: "status" }, 1000));
    ports[0].close();
    expect((await status).code).toBe("no-host");
  });

  it("passes the host's own app-not-running answer through", async () => {
    const { client, ports } = setup();
    const status = rejection(client.request({ type: "status" }, 1000));
    ports[0].answer({ id: "1", type: "error", code: "app-not-running", message: "SilentSilo is not running." });
    ports[0].close();
    expect((await status).code).toBe("app-not-running");
  });

  it("opens a new port for the next request", async () => {
    const { client, ports } = setup();
    const first = rejection(client.request({ type: "status" }, 1000));
    ports[0].close();
    await first;
    void client.request({ type: "status" }, 1000);
    expect(ports).toHaveLength(2);
    expect(ports[1].last()).toEqual({ id: "2", type: "status" });
  });

  it("closes an idle port, and keeps it open while a request waits", async () => {
    const { client, ports } = setup();
    const fill = client.request({ type: "fill", origin: "https://github.com", ref: "r" }, 60_000);
    vi.advanceTimersByTime(5000);
    expect(ports[0].disconnected).toBe(false);
    ports[0].answer({ id: "1", type: "fill", username: "u", password: "p" });
    await fill;
    vi.advanceTimersByTime(999);
    expect(ports[0].disconnected).toBe(false);
    vi.advanceTimersByTime(1);
    expect(ports[0].disconnected).toBe(true);
  });
});
