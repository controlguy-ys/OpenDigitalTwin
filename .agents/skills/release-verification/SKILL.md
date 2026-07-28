---
name: release-verification
description: Select and run a closed OpenDigitalTwin verification scope from changed paths, then report release evidence and unverified boundaries. Use before staging or releasing repository changes; stage only requested files.
---

1. Run `git status --short` before selecting any release verification.
2. Classify changed paths and choose the narrowest closed `npm run verify:codex -- --scope <scope> --json` profile: `guidance` for repository guidance only, `project-v5` for Project V5 changes, `gateway` for Runtime Gateway changes, `ui` for browser/UI changes, and `full` when changes cross profiles or the scope is not closed.
3. Run the selected profile and `git diff --check`; retain the JSON report and the exact failed check if verification stops early.
4. Report changed paths, chosen scope, passed and failed checks, and any unverified browser, Gateway runtime, PLC/Robot, deployment, or public-access boundaries.
5. Stage only the files explicitly requested for the release. Do not use broad staging commands that include unrelated changes.
