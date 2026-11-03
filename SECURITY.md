# Security policy

## Reporting a vulnerability

Please **don't open a public issue** for a security problem.

Report it privately through GitHub: go to the [Security tab](https://github.com/Karajelly/stillfield/security/advisories/new) and choose **Report a vulnerability**. Include what you found, how to reproduce it, and what you think the impact is.

This is a small, personally maintained project, so I can't promise a fixed response time. I'll aim to acknowledge reports within about a week and to keep you updated on a fix.

## Scope

Stillfield is an offline game. It has no accounts, backend, or analytics, and it sends no player data anywhere. The areas where a vulnerability is most plausible are:

- Loading or migrating save files (browser storage and native files)
- The service worker and offline caching on [stillfield.io](https://stillfield.io)
- The build and dependency chain

## Supported versions

Only the latest `main` and the version currently deployed at stillfield.io are supported.
