# Contributing

Thanks for helping make conversation exports more reliable.

## Before opening a pull request

1. Keep the extension dependency-free unless a dependency is essential and discussed first.
2. Preserve local-only processing: no telemetry, remote service, storage, or new host access.
3. Add or update a regression test for every behavior change.
4. Run the complete checks:

   ```bash
   npm test
   npm run check
   ```

5. Test the unpacked extension in current Chrome on a non-sensitive sample conversation.
6. Update the README or privacy statement if user-visible behavior or permissions change.

## Pull requests

Keep each pull request focused. Explain the problem, the expected behavior, the test evidence, and any privacy or permission impact. Do not include exported conversations, signed media links, credentials, personal paths, or screenshots containing private content.

By participating, you agree to follow [CODE_OF_CONDUCT.md](CODE_OF_CONDUCT.md).
