# Contributing

Thanks for helping make conversation exports more reliable.

## Before opening a pull request

1. Keep the extension dependency-free unless a dependency is essential and discussed first.
2. Preserve local-only processing: no telemetry or developer-operated remote service. Review any additional storage or host access explicitly against PRIVACY.md. Existing local metadata storage must never contain conversation text or file bytes.
3. Add or update a regression test for every behavior change.
4. Edit `src/content/` and `src/popup/`, then regenerate the shipped scripts with
   `npm run build`. The checked-in `content.js` and `popup.js` are built from
   these sources so the extension can run without a build tool installed.
5. Run the complete checks:

   ```bash
   npm test
   npm run check
   ```

6. Test the unpacked extension in current Chrome on a non-sensitive sample conversation.
7. Update the README or privacy statement if user-visible behavior or permissions change.

## Pull requests

Keep each pull request focused. Explain the problem, the expected behavior, the test evidence, and any privacy or permission impact. Do not include exported conversations, signed media links, credentials, personal paths, or screenshots containing private content.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
