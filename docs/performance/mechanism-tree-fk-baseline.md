# Tree FK benchmark baseline

- Date: 2026-07-29 (Asia/Seoul)
- HEAD commit: `26e559931d70e937cfdf624e98fcb0da6099bd03`
- Measured source identity: `26e559931d70e937cfdf624e98fcb0da6099bd03+source:d40152dc298a030c0188870f4aea10b8c87e08b93c9d399e6868d8c74531660b`
- Source fingerprint: `d40152dc298a030c0188870f4aea10b8c87e08b93c9d399e6868d8c74531660b` (SHA-256 over benchmark-critical source content)
- Platform: Windows (`win32`)
- Hardware: Intel(R) Core(TM) Ultra 7 258V, 8 logical cores
- Node: `v22.15.1`
- Fixture: 128 Bodies, 127 Tree Joints (64 movable, 63 fixed), four root branches
- Samples: 2,000 warm-up evaluations; five batches of 10,000 evaluated samples
- Aggregate p50: 0.6283 ms
- Aggregate p95: 1.1404 ms
- Approved target: warm p95 <= 4 ms
- Result: PASS

This is a baseline for this development machine and Node version only. It does
not claim to generalize to other hardware or browsers. The source identity is
not a claim that the HEAD commit alone contains the measured working-tree code.
