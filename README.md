# SilentSilo browser extension

Fills logins from a SilentSilo silo into the browser, on the computer where
the desktop app is running. Not released yet.

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

## What it asks the browser for

- `nativeMessaging`, to talk to the desktop app.
- `activeTab` and `scripting`, to write into the tab you clicked the button
  on, only then, and only in its top frame.

No access to all sites, no content script that runs on every page, no
storage. The popup and the service worker load nothing from the network: the
manifest's content security policy allows only the extension's own files.

The protocol with the desktop app is in [docs/PROTOCOL.md](docs/PROTOCOL.md).
The extension needs SilentSilo 1.2.0 or later.

## Build

Node 22.12 or later.

```
npm ci
npm run typecheck
npm run lint
npm test
npm run build      # dist/chrome/, loadable unpacked
npm run package    # dist/silentsilo-chrome-<version>.zip, for the store
```

`npm run icons` renders `icons/icon.svg` to the PNG sizes. The PNGs are
committed, so a build does not need it.

The development build carries a public key in its manifest, so the unpacked
extension always gets the same id, `acgmibddhpnmaegpegjcibekcnihpfic`, which
the desktop app's native host allows. The store build leaves the key out;
the store assigns its own id.

## Load it unpacked

1. `npm run build`.
2. Open `chrome://extensions` (in Edge, `edge://extensions`) and turn on
   developer mode.
3. Choose "Load unpacked" and pick the `dist/chrome` folder.
4. Pin the SilentSilo button to the toolbar.

Filling needs the desktop app installed, running and unlocked. Without it
the popup says which of the three is missing.

## Licence

AGPL-3.0-or-later, like the rest of SilentSilo. Contributions are accepted
under [CLA.md](CLA.md).
