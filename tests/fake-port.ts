import type { NativePort } from "../src/background/native-client";

// A native port the test drives by hand: it records what the extension sends
// and lets the test answer, or close the port, whenever it likes.
export class FakePort implements NativePort {
  sent: Record<string, unknown>[] = [];
  disconnected = false;
  error: { message?: string } | null = null;
  private messageListeners: ((message: unknown) => void)[] = [];
  private disconnectListeners: (() => void)[] = [];

  onMessage = { addListener: (callback: (message: unknown) => void) => this.messageListeners.push(callback) };
  onDisconnect = { addListener: (callback: () => void) => this.disconnectListeners.push(callback) };

  postMessage(message: unknown): void {
    // Native messaging serializes to JSON; so does this.
    this.sent.push(JSON.parse(JSON.stringify(message)));
  }

  disconnect(): void {
    this.disconnected = true;
  }

  answer(message: unknown): void {
    for (const listener of this.messageListeners) listener(message);
  }

  // The browser closing the port, as when the host exits. `error` is what
  // Firefox puts on the port; Chrome reports through lastError instead.
  close(error?: string): void {
    this.disconnected = true;
    if (error !== undefined) this.error = { message: error };
    for (const listener of this.disconnectListeners) listener();
  }

  last(): Record<string, unknown> {
    return this.sent[this.sent.length - 1];
  }
}
