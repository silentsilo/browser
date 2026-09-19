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
- **The browser** starts the host and names the calling extension in the
  arguments. The host accepts Chrome, Edge, Brave and Firefox, and refuses
  any id not in its own list for that browser, before it opens the pipe.
  - Chrome and Edge pass the extension's origin first
    (`chrome-extension://<id>/`). Brave has no registry key of its own: it
    reads Chrome's, and installs the Chrome Web Store build, so it is let in
    under the Chrome Web Store id.
  - Firefox passes the path of the host manifest it read, then the add-on
    id (`browser@silentsilo.com`). A Firefox id belongs to whoever first
    submits it to addons.mozilla.org, so a release host trusts it only
    after our AMO submission has claimed it. Until then only development
    builds of the host accept it.
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

`show` is the one request that is not about passwords. It is allowed because
it reveals nothing: its answer carries no field beyond `id` and `type`, the
same whatever state the app is in, and it cannot unlock anything or start a
fill.

## Messages

Every request carries `id` (a string the extension chooses, echoed in the
answer) and `type`. Every answer carries the same `id` and either the answer
for that `type` or `"type": "error"`.

### status

```json
{ "id": "1", "type": "status" }
{ "id": "1", "type": "status", "state": "unlocked", "silo": "Personal", "version": "1.2.0" }
```

`state` is `unlocked`, `locked` or `no-silo`. `silo` is present only while
unlocked. `version` is the app's version, so the extension can say "update
SilentSilo" when the protocol moves.

### logins

The logins saved for a site. The origin comes from the extension's own view of
the tab (`chrome.tabs`), never from the page.

```json
{ "id": "2", "type": "logins", "origin": "https://github.com" }
{ "id": "2", "type": "logins", "origin": "https://github.com",
  "logins": [ { "ref": "c1f0…", "label": "GitHub", "username": "alex@example.com" } ] }
```

- Only `https:` origins, plus `http://localhost` and loopback addresses. Any
  other origin answers an empty list, even while the app is locked.
- A login matches when the host of its saved address equals the tab's host,
  or when one is `www.` plus the other. Nothing else: no parent domains, no
  similar names, no guessing from the label.
- Ports must be equal. A saved address without a port means its scheme's
  default port (443, or 80 for `http://`), never any port. A saved `http://`
  address also matches the same host over https on 443. On `localhost` and
  loopback addresses, where each port is another program, the port must be
  written the same in both: a saved `localhost` matches only a tab without a
  port.
- `ref` is opaque, valid only while this silo stays unlocked, and useless
  outside a `fill`.
- No passwords, no notes, no TOTP secrets. A username is shown so a person
  with two accounts can pick one.

### search

Asked only when the person types in the popup, because nothing matched or
they want another login. Same answer shape as `logins`, at most 20 results,
matched on label and username. A query shorter than two characters, counted
after trimming, answers an empty list; the extension does not send one, and
the popup says "Type at least two characters".

```json
{ "id": "3", "type": "search", "query": "bank" }
{ "id": "3", "type": "search",
  "logins": [ { "ref": "…", "label": "Bank", "username": "alex", "site": "bank.example" } ] }
```

The answer has no `origin`: search is not tied to a site. Each result carries
`site`, the host (with the port, when the saved address has one) of the
address the login was saved for, or `""` when it has none. The popup shows
it beside each result, so a login saved for another site is named as such
before anyone asks for a fill. A result without `site` is shown as saved for
an unknown site.

The popup offers search only after a deliberate click. On a site where
nothing matches it first warns that the address may not be the site the
person thinks, and only "Search anyway" opens the search box.

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

The app waits 90 seconds for the confirmation, prompt included, then answers
`cancelled`. The extension's own timeout for a fill is longer than that.

The extension writes the two values into the fields and drops them. It does
not keep or store them, never sends them anywhere else and never logs them.
Copies may stay in the browser's memory until garbage collection.

### show

Asks the app to bring its window to the front, for the person to unlock
their silo there. The popup sends it from its "Open SilentSilo" button, shown
when the silo is locked or the app has no silo yet.

```json
{ "id": "5", "type": "show" }
{ "id": "5", "type": "show" }
```

The app unminimises, shows (it may be hidden in the notification area) and
focuses its window. While the silo is locked the window is on its unlock
screen, and the unlock happens there as it always does, with Windows Hello
or the security key. While it is unlocked the window just comes forward. The
window is not kept above other windows.

The answer carries nothing but `id` and `type`. Nothing secret goes either
way, and the extension does not wait for the unlock or continue with a fill
afterwards: the person clicks the extension again.

`show` counts against the same rations as `logins` and `search`, per
connection and across all of them. On top of that the app answers `busy` to
a `show` within 3 seconds of the last one it acted on, so a program running
as the same user cannot keep raising the window.

### Errors

```json
{ "id": "4", "type": "error", "code": "cancelled", "message": "The fill was not confirmed." }
```

| code | meaning |
|---|---|
| `app-not-running` | answered by the host: nothing listens on the pipe, or the pipe is not the real app's (another user's, or served by another program) |
| `locked` | no silo is unlocked |
| `no-silo` | the app has no silo yet |
| `unknown-ref` | the ref is stale (the silo locked, or was switched) |
| `cancelled` | the person declined or the prompt timed out |
| `bad-request` | malformed, too large, unknown type, disallowed origin |
| `busy` | another fill is waiting for confirmation, too many requests (any of `logins`, `search`, `show`, `fill`), a fill was declined or timed out in the last few seconds, or a `show` came within 3 seconds of the last one |
| `no-authenticator` | the silo has no security key or Windows Hello set up, so no fill can be confirmed |

`message` is informational, for logs and debugging. The extension does not
display it: the popup shows its own text for each code, and one generic line
for a code it does not know. Words that came over the pipe never reach the
extension's interface, so a process squatting the pipe cannot use it to
phish.

A request too large or too malformed to read an `id` from is answered with
`"id": ""`. The host's `app-not-running` also covers the app running with its
Browser extension setting off: the pipe does not exist then either.

The popup shows `busy` as "SilentSilo is busy. Try again in a few seconds.",
whatever the cause, and from any request.

A host started by anything other than a supported browser exits before it
reads a message. The extension sees only the port closing, and shows it like a
host that found no app: SilentSilo is not running. A host the browser cannot
find, or that does not list this extension, is shown as not installed.

## Versions

`status.version` carries the app version. The extension checks it against the
lowest version that speaks this protocol and, below that, says which version
to install rather than trying.
