# CRB 12-Pose Technical Demo

This deterministic browser demo proves that one Robot-owned Simulation Job can
execute more than ten ordered Joint Poses with independent transition speeds.

## Run the demo

1. Start the Web application and open **Project → Samples → Dual-Robot Technical Demo**.
2. Select **ABB CRB15000** in Scene Objects.
3. Select **CRB 12-Pose Technical Demo** in Robot Jobs.
4. Open the Timeline and confirm `12 steps` and `12 Joint Poses`.
5. Press **Start Job** and observe `RUNNING → SUCCEEDED`.

The sequence takes approximately 5.2 seconds with the built-in CRB joint
velocity limits. It starts and ends at Home, so it is repeatable.

| Pose | J1 | J2 | J3 | J4 | J5 | J6 | Speed to next |
|---:|---:|---:|---:|---:|---:|---:|---:|
| 1 | 0 | 0 | 0 | 0 | 0 | 0 | 20% |
| 2 | 20 | -15 | -20 | 10 | 15 | 0 | 25% |
| 3 | 40 | -30 | -40 | 20 | 25 | 30 | 30% |
| 4 | 60 | -20 | -55 | 45 | 10 | 60 | 35% |
| 5 | 35 | 5 | -45 | 70 | -20 | 90 | 25% |
| 6 | 0 | 20 | -30 | 90 | -35 | 120 | 30% |
| 7 | -35 | 5 | -45 | 70 | -20 | 90 | 35% |
| 8 | -60 | -20 | -55 | 45 | 10 | 60 | 25% |
| 9 | -40 | -30 | -40 | 20 | 25 | 30 | 30% |
| 10 | -20 | -15 | -20 | 10 | 15 | 0 | 25% |
| 11 | 0 | -10 | -10 | -20 | 10 | -30 | 20% |
| 12 | 0 | 0 | 0 | 0 | 0 | 0 | End |

## Acceptance checks

- [x] Project V4 validation accepts the Job.
- [x] The Job contains 12 ordered Joint Poses and at least 10 distinct poses.
- [x] Every Pose contains exactly J1-J6 and stays inside the built-in limits.
- [x] J1 crosses above +50° and below -50° during browser playback.
- [x] Timeline progress never exceeds `12 of 12` and follows the active card.
- [x] Runtime reaches `SUCCEEDED` and J1-J6 return to Home.
- [x] The logical slide Robot retains independent state and can run afterward.

## Remaining scope checklist

These items are not required for this Joint-space Technical Demo:

- [ ] Named Pose metadata and per-step dwell time.
- [ ] Cartesian TCP targets, inverse kinematics, and reachability proof.
- [ ] Collision findings that automatically stop Job playback.
- [ ] Runtime trace export for commanded and actual Joint values.
- [ ] Synchronized multi-Robot Job scheduling.
- [ ] Full-sequence Cancel/Restart browser acceptance; generic cancellation and
  restart behavior remains covered by the Job runtime tests.
- [ ] Action steps such as Attach/Detach; the browser action execution boundary
  is not installed in this release, so this demo intentionally uses Joint Poses only.
