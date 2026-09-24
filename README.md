# SilentSilo browser extension

Fills logins from a SilentSilo silo into the browser. It works with the
SilentSilo desktop app on Windows, version 1.2.0 or later, running on the
same computer.

Not released yet. The store listings wait for SilentSilo 1.2.0, the first
desktop release that answers the extension. The Chrome Web Store has
assigned the extension its id, and addons.mozilla.org holds the Firefox id
`browser@silentsilo.com`.

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

Pages cannot talk to the extension: it has no content script, and its
background script answers only its own popup. A program running as you on
this computer can reach the desktop app the way the extension does and ask
for a fill. The app shows every fill request, and nothing is sent until you
confirm it there.

To find the logins for a site, the desktop app decrypts every password entry
of the open silo in its own memory on each lookup, keeps the label, username
and address, and wipes the rest straight away. None of that reaches the
extension; the one password a fill needs is read again only after you
confirmed.

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

Windows only for now: the desktop app's native host, which the browser
talks to, is built for Windows. Each browser finds it through its own
native host registration, which the desktop installer writes. Nothing for
mobile browsers: the Android app fills logins through the system's own
autofill instead.

## What it asks the browser for

- `nativeMessaging`, to talk to the desktop app.
- `activeTab` and `scripting`, to write into the tab you clicked the button
  on, only then, and only in its top frame.

No access to all sites, no content script, no storage. The popup and the
service worker load nothing from the network: the manifest's content
security policy allows only the extension's own files.

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

A development build can pin its unpacked id with a key of your own in
`manifest/chrome.dev.json` (`{ "key": "<base64 public key>" }`). That file
is gitignored and never committed: whoever has the public key can build an
extension with the same id, so each developer keeps their own. Debug builds
of the desktop app's native host accept the ids listed in its
`allowed-origins.dev.json`; a release never does. Without the file, the
unpacked extension gets a random id. The store build leaves any key out, and
`npm run package` refuses to build if one is there. The store assigns its
own id.

Firefox does not use the key. Its id is fixed in the manifest, in both the
development and the store build. A Firefox id belongs to whoever first
submits it to addons.mozilla.org; our submission of 20 September 2026
claimed `browser@silentsilo.com`, so release builds of the native host
accept it.

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

Filling needs the desktop app installed, running with Settings > Browser
extension turned on, and unlocked. Without one of these the popup says
which is missing.

## Licence

AGPL-3.0-or-later, like the rest of SilentSilo. Contributions are accepted
under [CLA.md](CLA.md).
