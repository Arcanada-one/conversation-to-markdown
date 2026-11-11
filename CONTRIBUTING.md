# Contributing

Thanks for helping make conversation exports more reliable.

## Before opening a pull request

1. Keep the shipped extension dependency-free. Bun and Biome are development tools only.
2. Preserve local-only processing: no telemetry or developer-operated remote service. Review any additional storage or host access explicitly against PRIVACY.md. Existing local metadata storage must never contain conversation text or file bytes.
3. Add or update a regression test for every behavior change.
4. Install [mise](https://mise.jdx.dev/), then run `mise run setup`. This installs
   the pinned Node and Bun versions, installs Biome, and activates the tracked
   pre-commit hook, which runs the unit tests on every commit.
5. Edit the modules in `src/content/` and `src/popup/`, then run `npm run build`.
   Bun bundles them into the checked-in `content.js` and `popup.js`; the
   extension runs without development tools installed.
6. Format and check the source:

   ```bash
   npm run format
   npm run lint
   ```
7. Run the complete checks:

   ```bash
   npm test
   npm run check
   ```

8. Test the unpacked extension in current Chrome on a non-sensitive sample conversation.
9. Update the README or privacy statement if user-visible behavior or permissions change.

## Pull requests

Keep each pull request focused. Explain the problem, the expected behavior, the test evidence, and any privacy or permission impact. Do not include exported conversations, signed media links, credentials, personal paths, or screenshots containing private content.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
