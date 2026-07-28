# Test Guidance

- Prefer role and accessible-name selectors before test IDs or implementation selectors.
- Assert exact successful terminal states.
- Do not use `SUCCEEDED | FAILED` assertions; successful flows must assert `SUCCEEDED` exactly.
