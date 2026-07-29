# Security Policy

## Supported version

Security fixes are applied to the latest version on the `main` branch.

## Report a vulnerability

Please use GitHub's **Report a vulnerability** form in the repository Security tab when it is available. This creates a private discussion with the maintainer.

If private vulnerability reporting is unavailable, open a public issue that contains only a request for a private contact channel. Do not include exploit details, conversation content, credentials, tokens, private URLs, or other secrets in a public issue.

Include the affected version, browser version, impact, reproduction steps using non-sensitive sample data, and any suggested mitigation. You should receive an acknowledgement within seven days. Please allow reasonable time for investigation and a coordinated fix before public disclosure.

## Scope

Reports about unauthorized data access, unsafe clipboard behavior, code execution, permission misuse, or a bypass of local-only processing are in scope. General ChatGPT service behavior and browser vulnerabilities should be reported to their respective vendors.

## What must never enter this repository

This is a public repository. Every commit is permanently visible, and deleting a
file later does not remove it from history, forks, or caches. The following must
never be committed:

- **Credentials of any kind** — API keys, access tokens, private keys, passwords,
  session cookies, `.env` files, or any signed URL carrying a `sig`, `token`,
  `signature`, or `expires` parameter.
- **Conversation content** — real ChatGPT conversation URLs (`chatgpt.com/c/<id>`),
  exported transcripts, or screenshots containing personal messages. Tests use
  synthetic fixtures only.
- **Local filesystem paths** that identify a machine or account — home
  directories on macOS, Linux, or Windows that carry a real user name.
- **Internal tracker identifiers** and references to private planning documents.

### How this is enforced

`tests/public-surface.test.js` runs on every push and pull request and fails the
build when any of these appear:

| Check | What it does |
| --- | --- |
| `no tracked file carries a credential` | Scans **every** tracked file against known credential shapes — private-key blocks, AWS/GitHub/Google/Slack/Vault/Cloudflare/GitLab/Telegram tokens, JWTs, OpenAI- and Anthropic-style keys, and assigned secret literals. Failures report the file, the rule, and the match length — never the value. |
| `every tracked file is declared in the allowlist` | Fails when a file is tracked but absent from `public-files.allowlist`, so a new file cannot reach the public surface unreviewed. |
| `allowlisted text files contain no private or internal material` | Scans allowlisted files for local paths, real conversation URLs, signed-URL parameters, and internal identifiers. |
| `shipped JavaScript has no network, storage, or analytics calls` | Keeps the extension local-only: no `XMLHttpRequest`, `WebSocket`, `chrome.storage`, or analytics. `fetch` is permitted solely inside `fetchImageDataUrls` in `content.js` for image download. |

Adding a file means adding it to `public-files.allowlist` in the same commit —
that is the review point where its contents get checked.

If a credential is ever committed, treat it as compromised: rotate it first, then
address the repository. Rotation comes first because history rewriting does not
retract existing forks or caches.
