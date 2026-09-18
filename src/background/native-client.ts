import { MAX_FRAME_BYTES, type RequestBody } from "./protocol";

// The part of chrome.runtime.Port the client uses, so tests can fake it.
export interface NativePort {
  postMessage(message: unknown): void;
  disconnect(): void;
  onMessage: { addListener(callback: (message: unknown) => void): void };
  onDisconnect: { addListener(callback: () => void): void };
}

export interface NativeClientOptions {
  connect: () => NativePort;
  // chrome.runtime.lastError at the moment the port closed.
  lastError: () => string | undefined;
  // How long an unused port stays open before the client closes it.
  idleMs?: number;
}

// Codes raised by the extension itself, beside the ones the app sends.
export type LocalErrorCode = "no-host" | "timeout" | "bad-answer";

// Carries the code only. An error answer's `message` is dropped here: the
// popup shows the extension's own text for each code, never words that came
// over the pipe.
export class ClientError extends Error {
  constructor(readonly code: string) {
    super(code);
    this.name = "ClientError";
  }
}

interface Pending {
  expect: string;
  resolve: (answer: Record<string, unknown>) => void;
  reject: (error: ClientError) => void;
  timer: ReturnType<typeof setTimeout>;
}

// One native port to the desktop app, opened on the first request and closed
// when it has been idle for a while. Answers are matched to requests by id.
export class NativeClient {
  private port: NativePort | null = null;
  private pending = new Map<string, Pending>();
  private nextId = 1;
  private idleTimer: ReturnType<typeof setTimeout> | null = null;
  private readonly idleMs: number;

  constructor(private readonly options: NativeClientOptions) {
    this.idleMs = options.idleMs ?? 30_000;
  }

  request(body: RequestBody, timeoutMs: number): Promise<Record<string, unknown>> {
    const id = String(this.nextId++);
    const message = { id, ...body };
    if (new TextEncoder().encode(JSON.stringify(message)).length > MAX_FRAME_BYTES) {
      return Promise.reject(new ClientError("bad-request"));
    }
    this.clearIdle();
    const port = this.ensurePort();
    return new Promise((resolve, reject) => {
      const timer = setTimeout(() => {
        this.pending.delete(id);
        reject(new ClientError("timeout"));
        this.scheduleIdle();
      }, timeoutMs);
      this.pending.set(id, { expect: body.type, resolve, reject, timer });
      try {
        port.postMessage(message);
      } catch {
        // The port closed under us; onDisconnect settles the request.
      }
    });
  }

  close(): void {
    this.clearIdle();
    const port = this.port;
    this.port = null;
    port?.disconnect();
    this.failAll(new ClientError("app-not-running"));
  }

  private ensurePort(): NativePort {
    if (this.port) return this.port;
    const port = this.options.connect();
    this.port = port;
    port.onMessage.addListener((message) => {
      if (this.port === port) this.receive(message);
    });
    port.onDisconnect.addListener(() => {
      if (this.port !== port) return;
      this.port = null;
      this.clearIdle();
      this.failAll(new ClientError(disconnectCode(this.options.lastError())));
    });
    return port;
  }

  private receive(message: unknown): void {
    if (typeof message !== "object" || message === null) return;
    const answer = message as Record<string, unknown>;
    if (typeof answer.id !== "string") return;
    const waiting = this.pending.get(answer.id);
    if (!waiting) return;
    this.pending.delete(answer.id);
    clearTimeout(waiting.timer);
    if (answer.type === "error") {
      const code = typeof answer.code === "string" ? answer.code : "bad-answer";
      waiting.reject(new ClientError(code));
    } else if (answer.type !== waiting.expect) {
      waiting.reject(new ClientError("bad-answer"));
    } else {
      waiting.resolve(answer);
    }
    this.scheduleIdle();
  }

  private failAll(error: ClientError): void {
    const waiting = [...this.pending.values()];
    this.pending.clear();
    for (const entry of waiting) {
      clearTimeout(entry.timer);
      entry.reject(error);
    }
  }

  private scheduleIdle(): void {
    if (this.pending.size > 0 || !this.port) return;
    this.clearIdle();
    this.idleTimer = setTimeout(() => this.close(), this.idleMs);
  }

  private clearIdle(): void {
    if (this.idleTimer !== null) clearTimeout(this.idleTimer);
    this.idleTimer = null;
  }
}

// Chrome reports why a native port closed only as text.
function disconnectCode(lastError: string | undefined): string {
  if (lastError && /not found|forbidden/i.test(lastError)) return "no-host";
  return "app-not-running";
}
