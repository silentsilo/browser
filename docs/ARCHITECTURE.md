# Architecture

The design decided before a line was written. Anything that changes what is
described here updates this page in the same commit.

## The one rule

**The extension holds nothing.** No key, no list of logins, no cache of
any of them. The one password it receives for a fill it writes into the
page and then drops: it does not keep or store it, and never sends it
anywhere else. Copies can stay in the browser's memory until the garbage
collector reclaims them, because JavaScript gives no way to wipe a string.
The browser is the most attacked program on the computer, with a hostile
page in every tab, and an extension is one more thing in it. The only way to make a
compromised extension harmless is to make sure there is nothing in it worth
taking.

**The extension reaches passwords only.** It can ask for logins (label,
username, the site they were saved for) and, after a confirmed fill, one
password. Beyond that it can ask the app to bring its window to the front
(`show`), so a locked silo can be unlocked there; that answer carries
nothing, and the unlock stays in the app. It cannot list, read or name files, folders, attachments, notes,
one-time codes or passkeys. The desktop app enforces this: the handlers that
answer the extension read password entries through their own narrow
function, with no path to the file store at all.

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
- **The native messaging host** sits between the browser and the app. It is
  a separate small program, `silentsilo-browser-host` (its own crate in the
  desktop repository), installed beside the app. The browser starts it; it
  relays messages to the running app over a named pipe and decides nothing.

## Matching

The app matches a login to a site by origin, the same rule the Android
autofill uses since core 1.6.0: a saved login carries the site it was saved
for, and it is offered only to that site. Nothing "looks similar": `paypal`
in the address of a phishing page matches nothing.

When nothing matches, the popup does not open a search box. A phishing page
can tell the person "search for paypal", so the popup says first that
nothing is saved for this address and that it may not be the site they
think, and the search box appears only after a click on "Search anyway".
Each search result names the site it was saved for, and the app's
confirmation says again when that is not the site being filled.

## The channel

Native messaging, not a local HTTP port. A port would be reachable by every
program on the computer and every page in every browser. The host manifest
is written by the desktop installer, under the current user, and removed on
uninstall.

What is actually checked, in the order a message meets it:

1. **The browser** starts the host only for an extension id listed in the
   host manifest's `allowed_origins`. Pages cannot open the channel.
2. **The host** reads the calling extension's origin from its first
   argument and refuses any id not compiled into it, and refuses to run when
   its parent process is not a browser.
3. **The host** checks that the pipe server is the real SilentSilo app
   before it sends anything.
4. **The app** checks that the pipe client is the signed host binary.
5. **The person** confirms every fill in the app, with Windows Hello or the
   security key, on a prompt that names the site and the login.

The app cannot know which extension is talking or which page a request came
from. It relies on the checks above for that, and the origin in a request is
the one the extension read from `chrome.tabs`. Messages carry the origin, a
request id and, on the way back, labels or one login. The app refuses when
no silo is unlocked. An error answer carries a code; the popup shows its own
text for each code and never the words that came with it, so nothing on the
other end of the pipe can write into the extension's interface.

## What this does not protect against

- **A program already running as the same Windows user.** It can drive the
  browser, or the programs between it and the app, and ask for fills. Each
  one still needs the person to confirm it in the app, so it gets a password
  only if the person confirms a prompt they did not start.
- **Replaced files.** The install is per user, so a program running as that
  user can also replace files the user owns, the host and its manifest
  included. Chrome does not check the host's signature before starting it;
  the checks above are what stands in the way, and a program that can
  rewrite the app itself is past all of them.
- **Confirming without reading.** The prompt names the site and says when a
  login was saved for another one. A person who confirms every prompt
  without reading it gives that protection away.

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
