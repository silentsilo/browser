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
username and password into the fields you are looking at. It does not keep
or store them.

So a page that manages to talk to the extension can ask for a fill, which
you see and confirm or refuse. It cannot read anything, because there is
nothing in the extension to read.

Why it is built this way, and what was ruled out, is in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md).

## Browsers

One codebase, Manifest V3, two builds.

- **Chrome and Edge**: the Chrome build (`dist/chrome`).
- **Brave**: the same Chrome build, installed from the Chrome Web Store.
  There is nothing to build for it separately.
- **Firefox**: its own build (`dist/firefox`), Firefox 140 or later, id
  `browser@silentsilo.com`. The code is the same; only the manifest differs,
  because Firefox runs the background script as an event page where Chrome
  runs a service worker.
- **Safari**: not planned. It needs a Mac to build and sign.

Each browser finds the desktop app through its own native host
registration, which the desktop installer writes. Nothing for mobile
browsers: the Android app fills logins through the system's own autofill
instead.

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
npm run build          # dist/chrome/ and dist/firefox/, loadable unpacked
npm run package        # dist/silentsilo-chrome-<version>.zip and
                       # dist/silentsilo-firefox-<version>.zip, for the stores
npm run lint:firefox   # the Firefox store build through web-ext lint
```

`node scripts/build.mjs chrome` or `node scripts/build.mjs firefox` builds one.
The Firefox zip is not minified, since addons.mozilla.org reviewers read the
shipped code; the bundle still counts as generated, so a submission points
the reviewer at this repository and these build steps.

`web-ext lint` reports one warning, about Firefox for Android: the data
collection declaration needs Android 142. The extension does not target
Android, and the minimum stays at 140 so Firefox ESR 140 can install it.

`npm run icons` renders `icons/icon.svg` to the PNG sizes. The PNGs are
committed, so a build does not need it.

The development build carries a public key in its manifest, so the unpacked
extension always gets the same id, `acgmibddhpnmaegpegjcibekcnihpfic`. The
key is public, so anyone can build an extension with that id: only debug
builds of the desktop app's native host accept it, never a release. The
store build leaves the key out, and `npm run package` refuses to build if
one is there. The store assigns its own id.

Firefox does not use the key. Its id is fixed in the manifest, in both the
development and the store build. The id is ours only once
addons.mozilla.org holds it, so the first AMO submission (listed or
unlisted; either one signs the add-on and reserves the id) must come before
a desktop release trusts the id. Until then only debug builds of the native
host accept it.

## Load it unpacked

Chrome, Edge or Brave:

1. `npm run build`.
2. Open `chrome://extensions` (in Edge, `edge://extensions`; in Brave,
   `brave://extensions`) and turn on developer mode.
3. Choose "Load unpacked" and pick the `dist/chrome` folder.
4. Pin the SilentSilo button to the toolbar.

Firefox:

1. `npm run build`.
2. Open `about:debugging`, then "This Firefox".
3. Choose "Load Temporary Add-on" and pick `dist/firefox/manifest.json`.
4. Pin the SilentSilo button to the toolbar from the extensions menu.

Firefox removes a temporary add-on when it closes.

Filling needs the desktop app installed, running and unlocked. Without it
the popup says which of the three is missing.

## Licence

AGPL-3.0-or-later, like the rest of SilentSilo. Contributions are accepted
under [CLA.md](CLA.md).
