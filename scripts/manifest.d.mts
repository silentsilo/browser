export declare const TARGETS: readonly string[];
export declare function composeManifest(
  target: string,
  options: { store: boolean; version: string; dir?: string },
): Record<string, unknown>;
export declare function checkManifest(target: string, manifest: Record<string, unknown>, options: { store: boolean }): void;
