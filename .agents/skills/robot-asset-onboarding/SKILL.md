---
name: robot-asset-onboarding
description: Deterministically inspect and validate OpenDigitalTwin Robot STEP assets, Geometry statistics, and explicit Joint/Link mappings. Use for Robot asset import or mechanics onboarding; never infer Joint topology from fused STEP geometry.
---

1. Read `AGENTS.md` and `references/acceptance.md`.
2. Inspect the active Project V5 Robot Definition and referenced asset hashes.
3. Run `npm run cad:validate`.
4. Verify STEP count and controlled Joint count independently.
5. Report Geometry statistics, missing references, mechanics provenance, and acceptance gaps.
6. Do not alter Joint topology automatically. Stop for human mechanics input when the source does not contain explicit deterministic mapping data.
