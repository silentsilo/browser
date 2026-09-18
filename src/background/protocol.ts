// The messages in docs/PROTOCOL.md, as types. That page is the contract with
// the desktop app; change it first, then this file.

export const HOST_NAME = "com.silentsilo.desktop";

// The lowest desktop version that speaks this protocol.
export const MIN_APP_VERSION = "1.2.0";

export type SiloState = "unlocked" | "locked" | "no-silo";

export interface LoginSummary {
  ref: string;
  label: string;
  username: string;
  // The site the login was saved for, in `search` answers: a host, "" when
  // the login has no address. Absent in `logins` answers.
  site?: string;
}

export type Request =
  | { id: string; type: "status" }
  | { id: string; type: "logins"; origin: string }
  | { id: string; type: "search"; query: string }
  | { id: string; type: "fill"; origin: string; ref: string };

// A request before the client gives it an id.
export type RequestBody = Request extends infer R ? (R extends Request ? Omit<R, "id"> : never) : never;

export interface StatusAnswer {
  id: string;
  type: "status";
  state: SiloState;
  silo?: string;
  version: string;
}

export interface LoginsAnswer {
  id: string;
  type: "logins" | "search";
  logins: LoginSummary[];
}

export interface FillAnswer {
  id: string;
  type: "fill";
  username: string;
  password: string;
}

export type ErrorCode =
  | "app-not-running"
  | "locked"
  | "no-silo"
  | "unknown-ref"
  | "cancelled"
  | "bad-request"
  | "busy"
  | "no-authenticator";

export interface ErrorAnswer {
  id: string;
  type: "error";
  code: ErrorCode | string;
  // Informational only. The extension never displays it.
  message?: string;
}

// Frames over this size are refused by the host and the app.
export const MAX_FRAME_BYTES = 64 * 1024;
