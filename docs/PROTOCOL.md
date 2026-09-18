# Protocol

What the extension and the desktop app say to each other. The two sides are
built in two repositories, so this page is the contract: a change here comes
first, then both sides, in the same release.

## The path a message takes

```
extension (service worker)
   | chrome.runtime.connectNative("com.silentsilo.desktop")
   v
silentsilo-browser-host.exe        started by the browser, one per connection
   | named pipe \\.\pipe\silentsilo-browser-<user SID>, current user only
   v
SilentSilo (the running desktop app)
```

- **The host** is a small separate executable installed beside the app. It
  holds nothing and decides nothing: it checks who started it, relays whole
  messages between the browser's stdio and the pipe, and exits when either
  side closes. It is a separate binary so the browser never starts the full
  app, with its webview, just to relay a message.
- **The browser** starts the host with the calling extension's origin as its
  first argument (`chrome-extension://<id>/`). The host refuses any id not
  in its own list, before it opens the pipe.
- **The pipe** is created by the app with an ACL granting the current user
  only. When the app is not running, the host answers `app-not-running`
  itself and exits. It never starts the app.

## Framing

Browser side: native messaging framing (a 32-bit little-endian length, then
UTF-8 JSON). Pipe side: the same framing, so the host copies frames without
parsing them beyond a size check. A frame over 64 KiB is refused by both the
host and the app.

## Scope

Passwords only. There is no message for files, folders, attachments, notes,
one-time codes or passkeys, and the app answers any `type` not listed below
with `bad-request`. Adding one would be a change to the threat model, which
starts in ARCHITECTURE.md.

## Messages

Every request carries `id` (a string the extension chooses, echoed in the
answer) and `type`. Every answer carries the same `id` and either the answer
for that `type` or `"type": "error"`.

### status

```json
{ "id": "1", "type": "status" }
{ "id": "1", "type": "status", "state": "unlocked", "silo": "Personal", "version": "1.2.0" }
```

`state` is `unlocked`, `locked` or `no-silo`. `version` is the app's version,
so the extension can say "update SilentSilo" when the protocol moves.

### logins

The logins saved for a site. The origin comes from the extension's own view of
the tab (`chrome.tabs`), never from the page.

```json
{ "id": "2", "type": "logins", "origin": "https://github.com" }
{ "id": "2", "type": "logins", "origin": "https://github.com",
  "logins": [ { "ref": "c1f0…", "label": "GitHub", "username": "alex@example.com" } ] }
```

- Only `https:` origins, plus `http://localhost` and loopback addresses. Any
  other scheme answers an empty list.
- A login matches when the host of its saved address equals the tab's host,
  or when one is `www.` plus the other. Nothing else: no parent domains, no
  similar names, no guessing from the label. Ports must match when the saved
  address has one.
- `ref` is opaque, valid only while this silo stays unlocked, and useless
  outside a `fill`.
- No passwords, no notes, no TOTP secrets. A username is shown so a person
  with two accounts can pick one.

### search

Asked only when the person types in the popup, because nothing matched or
they want another login. Same answer shape as `logins`, at most 20 results,
matched on label and username.

```json
{ "id": "3", "type": "search", "query": "bank" }
```

### fill

```json
{ "id": "4", "type": "fill", "origin": "https://github.com", "ref": "c1f0…" }
{ "id": "4", "type": "fill", "username": "alex@example.com", "password": "…" }
```

The app shows its own confirmation, above other windows, naming the site and
the login, and asks for Windows Hello or the security key, the same prompt it
uses when a secret is copied. Nothing is sent before that succeeds.

When the login was not saved for this origin (it came from `search`), the
confirmation says so in words ("This login was saved for bank.example, not
for bank-login.example") and needs the same prompt; it is never skipped.

The extension writes the two values into the fields and drops them. It never
stores them, never sends them anywhere else and never logs them.

### Errors

```json
{ "id": "4", "type": "error", "code": "cancelled", "message": "The fill was not confirmed." }
```

| code | meaning |
|---|---|
| `app-not-running` | answered by the host: nothing listens on the pipe |
| `locked` | no silo is unlocked |
| `no-silo` | the app has no silo yet |
| `unknown-ref` | the ref is stale (the silo locked, or was switched) |
| `cancelled` | the person declined or the prompt timed out |
| `bad-request` | malformed, too large, unknown type, disallowed origin |
| `busy` | another fill is waiting for confirmation |

`message` is for the popup to show as it is; the extension adds nothing to it.

## Versions

`status.version` carries the app version. The extension checks it against the
lowest version that speaks this protocol and, below that, says which version
to install rather than trying.
