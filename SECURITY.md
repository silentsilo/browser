# Security Policy

## Reporting a vulnerability

Report vulnerabilities privately to **security@silentsilo.com**. Please do
not open a public issue for anything that could be a vulnerability.

The same address covers [silentsilo/core](https://github.com/silentsilo/core),
[silentsilo/desktop](https://github.com/silentsilo/desktop) and
[silentsilo/mobile](https://github.com/silentsilo/mobile). Report to
whichever repository you found it in; it reaches the same person either way.

This is a one-person project, so reports are read by one person: the aim is
an acknowledgement within 72 hours. Please include steps to reproduce, the
browser and its version, and the commit or release you tested against.

## Scope

This repository is the browser extension: what it asks the desktop app for,
how it decides which site a login belongs to, what it writes into a page and
what it keeps in the browser (which is meant to be nothing). The desktop app
answers those requests and holds every secret; its policy is in
silentsilo/desktop. The cryptography and the formats are core's.
