# Codex Workflows

## Start the local stack

Run the browser and Runtime Gateway together with:

```powershell
npm run dev:stack
```

The command builds the Gateway, starts both local services, reports their URLs,
and stops the process trees when it receives an interrupt or termination signal.

## Run scoped verification

Choose the narrowest closed scope that covers the changed paths. For example,
Project V5 work uses:

```powershell
npm run verify:codex -- --scope project-v5 --json
```

| Scope | Use for | Checks run |
| --- | --- | --- |
| `guidance` | Repository guidance or Skills only | Guidance and Skill validation |
| `project-v5` | Project V5 contracts or Project V5 features | Guidance validation, Project V5 tests, lint, and web build |
| `gateway` | Runtime Gateway changes | Guidance validation, Gateway tests, Gateway build, and Gateway configuration check |
| `ui` | Browser or UI changes | Guidance validation, connectivity UI tests, and browser E2E tests |
| `full` | Changes crossing profiles or work without a closed scope | Full repository verification |

With `--json`, the command emits one structured report to standard output. It
includes the status, selected scope, observation time, per-check command and
exit code, warnings, and artifact paths. The same bounded report is atomically
recorded at `artifacts/codex/latest-verification.json`; the artifact contains
verification metadata, not captured command output, environment variables, or
absolute paths.

Run `git diff --check` after the selected profile. Keep the report and name any
failed checks or unverified browser, Gateway, PLC/Robot, deployment, or
public-access boundary in the handoff.

## Available repository Skills

- `robot-asset-onboarding` for deterministic Robot STEP asset and mechanics acceptance checks.
- `opcua-runtime-diagnostics` for read-only Runtime Gateway and endpoint diagnosis.
- `release-verification` for selecting a closed verification scope and reporting release evidence.

## Safety boundary

Repository Skills and verification commands do not write to external OPC UA
Servers or physical controllers. They do not issue physical PLC or Robot
actions; any such action requires explicit current-task authorization.
