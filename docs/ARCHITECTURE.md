# Architecture

The design decided before a line was written. Anything that changes what is
described here updates this page in the same commit.

## The one rule

**The extension holds nothing.** No key, no password, no list of logins, no
cache of any of them, not even for a second longer than a fill takes. The
browser is the most attacked program on the computer, with a hostile page in
every tab, and an extension is one more thing in it. The only way to make a
compromised extension harmless is to make sure there is nothing in it worth
taking.

Every alternative was ruled out for that reason:

- Unlocking the silo in the extension, the way most password managers do,
  would put the key in browser memory.
- Caching the list of sites for a faster popup would tell a compromised
  extension every account the user has.
- Silent fill on page load, without a confirmation, would let any page that
  can reach the extension pull a password with no human in the loop.

## The three parties

```
page  <->  extension (content script + popup)  <->  desktop app (native messaging host)
```

- **The page** gets exactly one thing: a username and a password written into
  two fields, after the user confirmed. It never gets a list, a message or a
  script beyond that write.
- **The extension** asks and writes. It sends the page's origin to the app,
  shows what the app answers (labels only, never secrets), and on the user's
  choice asks for one fill.
- **The desktop app** answers. It owns the silo, decides what matches, asks
  Windows Hello or the security key, and hands over one login for one fill.
  The native messaging host is part of the app, in `silentsilo-shell`, and is
  registered for the extension's id alone.

## Matching

The app matches a login to a site by origin, the same rule the Android
autofill uses since core 1.6.0: a saved login carries the site it was saved
for, and it is offered only to that site. Nothing "looks similar": `paypal`
in the address of a phishing page matches nothing. When nothing matches, the
popup offers a search, so the choice to fill somewhere else is the user's and
is made deliberately.

## The channel

Native messaging, not a local HTTP port. A port would be reachable by every
program on the computer and every page in every browser; the browser's
native messaging channel is opened by the browser itself, only for the
extension id named in the host's manifest, and the app can tell which
extension is talking. The host manifest is written by the desktop installer,
under the current user, and removed on uninstall.

Messages carry the origin, a request id and, on the way back, labels or one
login. The app refuses anything from an origin the browser did not report
itself, and it refuses when no silo is unlocked, with a reason the popup
shows in words.

## Confirmation

Every fill is confirmed in the app, not in the extension: the prompt is the
same one the app uses when a secret is copied, and it names the site. A
confirmation dialog drawn by the extension would be drawn inside the
browser, which is what we do not trust.

## What the first version does not do

- Save a login from a page. The app is where logins are made.
- Fill anything but a username and a password. No cards, no addresses.
- Watch the page. No form detection on load, no scanning; the user clicks
  the button.
- Run on mobile browsers. Android has the system autofill for that.

Each of these can come later. Each of them widens what the extension does
inside the page, so each of them is a change to this document first.

## Browsers and stores

Manifest V3 throughout. Chrome and Edge share one build and one native host
manifest format; Firefox has its own manifest location and its own store,
and comes second. Store review is a fact of life here: the listing says what
the extension does in the terms above, and the source is this repository.
