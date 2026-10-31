# CrownThrive fork changes

Fork-only entries live here to avoid conflicts when upstream inserts release notes
at the start of the upstream CHANGELOG.md.

## Unreleased

- Split credential-independent MCP regression tests (`npm test`) from explicit
  live credential verification (`npm run test:integration`). Upstream sync can
  validate candidates without provider secrets. Runtime authentication and live
  credential verification are unchanged.
