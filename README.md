# SilentSilo browser extension

Fills logins from a SilentSilo silo into the browser, on the computer where
the desktop app is running. Not released yet; nothing here is built.

The desktop application is [silentsilo/desktop](https://github.com/silentsilo/desktop),
the engine and the formats are [silentsilo/core](https://github.com/silentsilo/core),
the phone apps are [silentsilo/mobile](https://github.com/silentsilo/mobile).

## What it is, and what it is not

The extension is a button and a form. It holds no key, no password and no
list of logins. When you ask it to fill a page, it sends the page's origin to
the desktop app over the browser's native messaging channel, the app looks
up the logins saved for exactly that site, and you confirm the fill in the
app with Windows Hello or your security key. The extension then writes the
username and password into the fields you are looking at, and forgets them.

So a page that manages to talk to the extension can ask for a fill, which
you see and confirm or refuse. It cannot read anything, because there is
nothing in the extension to read.

Why it is built this way, and what was ruled out, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Browsers

One codebase, Manifest V3. Chrome and Edge first, Firefox after. Nothing for
mobile browsers: the Android app fills logins through the system's own
autofill instead.

## Licence

AGPL-3.0-or-later, like the rest of SilentSilo. Contributions are accepted
under [CLA.md](CLA.md).
