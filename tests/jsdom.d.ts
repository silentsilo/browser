// The part of jsdom the store build test uses. Vitest brings jsdom, not its
// types.
declare module "jsdom" {
  export class JSDOM {
    constructor(html: string, options?: { url?: string; runScripts?: "dangerously" | "outside-only" });
    readonly window: Window & { eval(code: string): unknown };
  }
}
