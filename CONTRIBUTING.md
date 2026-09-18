# Contributing to the SilentSilo browser extension

Thanks for considering a contribution. This repository holds the browser
extension. The desktop application it talks to lives in
[silentsilo/desktop](https://github.com/silentsilo/desktop); the engine, the
persisted formats and the cryptography in
[silentsilo/core](https://github.com/silentsilo/core).

## Contributor License Agreement

Contributions are accepted under the terms of [CLA.md](CLA.md). Opening a
pull request constitutes acceptance; you keep the copyright to your work.
Please read it once before your first PR. It is short and written to be
readable.

## The rule that matters most

The extension holds no secrets. Not a key, not a password, not the list of
logins. Everything it shows or fills is asked from the desktop app, one
request at a time, and each fill is confirmed there. A change that caches
something in the browser to make the extension faster or smarter is a change
to the threat model, and it needs the discussion in
[docs/ARCHITECTURE.md](docs/ARCHITECTURE.md) first, not a pull request.
