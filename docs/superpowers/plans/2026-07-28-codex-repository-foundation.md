# Codex Repository Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the OpenDigitalTwin repository self-describing to Codex and add deterministic, machine-readable repository verification and local stack startup commands.

**Architecture:** Keep durable rules in concise root and nested `AGENTS.md` files, package three repeatable workflows as repo Skills, and implement cross-platform Node.js runners for verification and local stack lifecycle. This slice does not add MCP tools or Project mutation behavior.

**Tech Stack:** Markdown, Node.js 22.15.1, npm 11.4.2, ECMAScript modules, Vitest 4.1.10, existing Vite and Runtime Gateway commands.

## Global Constraints

- Project V5 is the active application architecture.
- Legacy features remain removed until the user explicitly requests them.
- Structured Text, PLC deployment, and external OPC UA writes are outside this plan.
- Scripts must run on Windows without Bash-only syntax.
- Verification JSON is written to stdout; human progress is written to stderr.
- Do not put credentials, CAD binaries, or arbitrary environment variables in reports.
- Stage only files owned by the current task.

---

## File Structure

### Create

- `AGENTS.md` — repository-wide architecture, safety, and completion guidance.
- `src/core/project-v5/AGENTS.md` — Project V5 contract rules.
- `middleware/runtime-gateway/AGENTS.md` — Gateway ownership and protocol rules.
- `tests/AGENTS.md` — acceptance and selector rules.
- `scripts/codex/validate-guidance.mjs` — deterministic guidance/Skill validator.
- `scripts/codex/validate-guidance.test.ts` — validator tests.
- `scripts/codex/verify-codex.mjs` — scoped verification orchestrator.
- `scripts/codex/verify-codex.test.ts` — verification report tests.
- `scripts/codex/dev-stack.mjs` — web and Gateway process supervisor.
- `scripts/codex/dev-stack.test.ts` — stack lifecycle tests.
- `.agents/skills/robot-asset-onboarding/SKILL.md` — deterministic Robot asset workflow.
- `.agents/skills/robot-asset-onboarding/references/acceptance.md` — Robot import evidence checklist.
- `.agents/skills/opcua-runtime-diagnostics/SKILL.md` — Runtime Gateway diagnostic workflow.
- `.agents/skills/release-verification/SKILL.md` — repository release verification workflow.
- `docs/developer/codex-workflows.md` — human-facing command and Skill guide.

### Modify

- `package.json` — add `dev:stack`, `verify:guidance`, and `verify:codex`.

## Task 1: Repository and Nested Guidance

**Files:**

- Create: `AGENTS.md`
- Create: `src/core/project-v5/AGENTS.md`
- Create: `middleware/runtime-gateway/AGENTS.md`
- Create: `tests/AGENTS.md`
- Create: `scripts/codex/validate-guidance.mjs`
- Create: `scripts/codex/validate-guidance.test.ts`

**Interfaces:**

- Produces: `validateGuidance(rootDirectory): Promise<GuidanceValidationResult>`
- Produces: four instruction files loaded by Codex through normal `AGENTS.md` discovery.

- [ ] **Step 1: Write the failing validator tests**

```ts
import { describe, expect, it } from 'vitest'
import { validateGuidanceSnapshot } from './validate-guidance.mjs'

describe('Codex repository guidance', () => {
  it('requires the exact instruction hierarchy and critical root sections', () => {
    const result = validateGuidanceSnapshot(new Map([
      ['AGENTS.md', '# OpenDigitalTwin\n'],
      ['src/core/project-v5/AGENTS.md', '# Project V5\n'],
      ['middleware/runtime-gateway/AGENTS.md', '# Gateway\n'],
      ['tests/AGENTS.md', '# Tests\n'],
    ]))
    expect(result.ok).toBe(false)
    expect(result.errors).toContain('AGENTS.md is missing section: ## Verification')
  })

  it('rejects guidance that re-enables Legacy behavior', () => {
    const result = validateGuidanceSnapshot(new Map([
      ['AGENTS.md', [
        '# OpenDigitalTwin', '## Architecture', 'Project V5',
        '## Commands', 'npm run verify', '## Safety', 'OPC UA',
        '## Verification', 'Acceptance', 'Enable Legacy adapter by default.',
      ].join('\n')],
      ['src/core/project-v5/AGENTS.md', '# Project V5'],
      ['middleware/runtime-gateway/AGENTS.md', '# Gateway'],
      ['tests/AGENTS.md', '# Tests'],
    ]))
    expect(result.errors).toContain('AGENTS.md must not enable Legacy behavior.')
  })
})
```

- [ ] **Step 2: Run the tests and confirm the validator does not exist**

Run:

```powershell
npx vitest run scripts/codex/validate-guidance.test.ts
```

Expected: FAIL because `validate-guidance.mjs` is missing.

- [ ] **Step 3: Implement the deterministic validator**

```js
const REQUIRED_FILES = Object.freeze([
  'AGENTS.md',
  'src/core/project-v5/AGENTS.md',
  'middleware/runtime-gateway/AGENTS.md',
  'tests/AGENTS.md',
])

const ROOT_SECTIONS = Object.freeze([
  '## Architecture',
  '## Commands',
  '## Safety',
  '## Verification',
])

export function validateGuidanceSnapshot(files) {
  const errors = []
  for (const file of REQUIRED_FILES) {
    if (!files.has(file)) errors.push(`Missing guidance file: ${file}`)
  }
  const root = files.get('AGENTS.md') ?? ''
  for (const section of ROOT_SECTIONS) {
    if (!root.includes(section)) errors.push(`AGENTS.md is missing section: ${section}`)
  }
  if (/\benable Legacy\b/iu.test(root)) {
    errors.push('AGENTS.md must not enable Legacy behavior.')
  }
  return Object.freeze({ ok: errors.length === 0, errors: Object.freeze(errors) })
}
```

Add `validateGuidance(rootDirectory)` using `node:fs/promises.readFile` and make the CLI print errors to stderr and exit `1` on failure.

- [ ] **Step 4: Write the four instruction files**

The root file must contain these concrete sections:

```md
# OpenDigitalTwin Repository Guidance

## Architecture
- Project V5 is the active source of truth.
- Project persistence is browser-owned; Runtime Gateway mirrors published revisions.
- Start code reading from `src/core/project-v5`, `src/features/project/v5`, and `middleware/runtime-gateway`.

## Commands
- Install: `npm install`
- Targeted tests: `npm run test:run -- <paths>`
- Full verification: `npm run verify`
- Codex verification: `npm run verify:codex -- --scope <scope> --json`

## Safety
- Never perform an external OPC UA write or physical PLC/Robot action unless the current user explicitly requests it.
- Preserve revision, lease, idempotency, and atomic publication boundaries.
- Do not restore Legacy functionality unless the user explicitly requests it.

## Verification
- Add a targeted test that fails before each behavioral fix.
- Run targeted tests, lint, relevant builds, and runtime acceptance proportional to the change.
- Do not call work complete when the browser, Gateway, or required E2E flow is unverified.
```

The nested files must state:

- Project V5: closed records, fresh revisions, stable error codes, and canonical validation.
- Gateway: Browser ownership, lease fencing, bounded bodies, no hidden persistence, and no external write expansion.
- Tests: role/name selectors first, exact successful terminal states, and no `SUCCEEDED | FAILED` assertions.

- [ ] **Step 5: Run the validator tests and the repository validator**

Run:

```powershell
npx vitest run scripts/codex/validate-guidance.test.ts
node scripts/codex/validate-guidance.mjs
```

Expected: tests PASS and validator exits `0`.

- [ ] **Step 6: Commit the guidance foundation**

```powershell
git add -- AGENTS.md src/core/project-v5/AGENTS.md middleware/runtime-gateway/AGENTS.md tests/AGENTS.md scripts/codex/validate-guidance.mjs scripts/codex/validate-guidance.test.ts
git commit -m "docs: add Codex repository guidance"
```

## Task 2: Machine-Readable Verification Runner

**Files:**

- Create: `scripts/codex/verify-codex.mjs`
- Create: `scripts/codex/verify-codex.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `parseVerifyArguments(argv): VerifyCodexOptions`
- Produces: `runVerification(options, dependencies): Promise<VerifyCodexReport>`
- Produces CLI: `npm run verify:codex -- --scope <scope> --json`

```ts
interface VerifyCodexReport {
  readonly status: 'passed' | 'failed'
  readonly scope: 'guidance' | 'project-v5' | 'gateway' | 'ui' | 'full'
  readonly observedAt: string
  readonly checks: readonly {
    readonly id: string
    readonly status: 'passed' | 'failed'
    readonly command: readonly string[]
    readonly exitCode: number
    readonly durationMs: number
  }[]
  readonly warnings: readonly string[]
  readonly artifacts: readonly string[]
}
```

- [ ] **Step 1: Write failing report and profile tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { runVerification } from './verify-codex.mjs'

describe('verify:codex', () => {
  it('runs the closed project-v5 profile in order and returns valid JSON data', async () => {
    const run = vi.fn(async () => ({ exitCode: 0, durationMs: 5 }))
    const report = await runVerification(
      { scope: 'project-v5', json: true },
      { run },
    )
    expect(run.mock.calls.map(([command]) => command)).toEqual([
      ['node', ['scripts/codex/validate-guidance.mjs']],
      ['npm', ['run', 'test:run', '--', 'src/core/project-v5', 'src/features/project/v5']],
      ['npm', ['run', 'lint']],
      ['npm', ['run', 'build']],
    ])
    expect(report.status).toBe('passed')
  })

  it('stops after the first required failure and reports the failing command', async () => {
    const run = vi.fn()
      .mockResolvedValueOnce({ exitCode: 0, durationMs: 1 })
      .mockResolvedValueOnce({ exitCode: 1, durationMs: 2 })
    const report = await runVerification(
      { scope: 'project-v5', json: true },
      { run },
    )
    expect(report.status).toBe('failed')
    expect(report.checks.at(-1)).toMatchObject({ status: 'failed', exitCode: 1 })
    expect(run).toHaveBeenCalledTimes(2)
  })

  it('atomically records the latest bounded verification report', async () => {
    const writeLatest = vi.fn(async () => undefined)
    await runVerification(
      { scope: 'guidance', json: true },
      { run: vi.fn(async () => ({ exitCode: 0, durationMs: 1 })), writeLatest },
    )
    expect(writeLatest).toHaveBeenCalledWith(
      expect.objectContaining({ status: 'passed', scope: 'guidance' }),
    )
  })
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npx vitest run scripts/codex/verify-codex.test.ts
```

Expected: FAIL because the runner is missing.

- [ ] **Step 3: Implement closed verification profiles**

```js
const PROFILES = Object.freeze({
  guidance: [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
  ],
  'project-v5': [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
    ['project-v5-tests', 'npm', ['run', 'test:run', '--', 'src/core/project-v5', 'src/features/project/v5']],
    ['lint', 'npm', ['run', 'lint']],
    ['web-build', 'npm', ['run', 'build']],
  ],
  gateway: [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
    ['gateway-tests', 'npm', ['run', 'test:gateway']],
    ['gateway-build', 'npm', ['run', 'build:gateway']],
    ['gateway-config', 'node', ['dist-gateway/middleware/runtime-gateway/main.js', '--check-config']],
  ],
  ui: [
    ['guidance', 'node', ['scripts/codex/validate-guidance.mjs']],
    ['ui-tests', 'npm', ['run', 'test:connectivity-ui']],
    ['browser-e2e', 'npm', ['run', 'test:e2e']],
  ],
  full: [
    ['full-verification', 'npm', ['run', 'verify']],
  ],
})
```

Use `spawn(command, args, { shell: false, stdio: ['ignore', 'pipe', 'pipe'] })`. Forward child stdout and stderr to the runner's stderr so `--json` leaves stdout as exactly one JSON document. On Windows, resolve npm as `npm.cmd`; on other platforms use `npm`. Reject unknown scopes before spawning anything.

After success or failure, atomically write the same bounded report to `artifacts/codex/latest-verification.json`. The `artifacts/` directory is already ignored. The report contains command names and exit codes, not captured command output, environment variables, or absolute paths.

- [ ] **Step 4: Add the package scripts**

Add:

```json
{
  "scripts": {
    "typecheck": "tsc -b --pretty false",
    "verify:guidance": "node scripts/codex/validate-guidance.mjs",
    "verify:codex": "node scripts/codex/verify-codex.mjs"
  }
}
```

Preserve every existing script.

- [ ] **Step 5: Run unit and real guidance profiles**

Run:

```powershell
npx vitest run scripts/codex/verify-codex.test.ts scripts/codex/validate-guidance.test.ts
npm run verify:codex -- --scope guidance --json
```

Expected: tests PASS; the CLI prints one valid JSON object with `"status":"passed"`, records `artifacts/codex/latest-verification.json`, and exits `0`.

- [ ] **Step 6: Commit the verification runner**

```powershell
git add -- package.json scripts/codex/verify-codex.mjs scripts/codex/verify-codex.test.ts
git commit -m "feat: add deterministic Codex verification"
```

## Task 3: Cross-Platform Local Development Stack

**Files:**

- Create: `scripts/codex/dev-stack.mjs`
- Create: `scripts/codex/dev-stack.test.ts`
- Modify: `package.json`

**Interfaces:**

- Produces: `createDevStack(dependencies): DevStack`
- Produces CLI: `npm run dev:stack`

```ts
interface DevStack {
  start(): Promise<{
    readonly webUrl: 'http://127.0.0.1:5173'
    readonly gatewayUrl: 'http://127.0.0.1:8081'
  }>
  stop(): Promise<void>
}
```

- [ ] **Step 1: Write failing lifecycle tests**

```ts
import { describe, expect, it, vi } from 'vitest'
import { createDevStack } from './dev-stack.mjs'

describe('dev:stack', () => {
  it('builds Gateway, starts Gateway and Vite, then waits for both probes', async () => {
    const spawn = vi.fn(() => ({ kill: vi.fn(), exited: Promise.resolve(0) }))
    const probe = vi.fn(async (url: string) => (
      url.endsWith('/healthz') || url === 'http://127.0.0.1:5173/'
    ))
    const stack = createDevStack({ spawn, probe, onSignal: vi.fn() })
    await expect(stack.start()).resolves.toEqual({
      webUrl: 'http://127.0.0.1:5173',
      gatewayUrl: 'http://127.0.0.1:8081',
    })
    expect(spawn.mock.calls.map(([command, args]) => [command, args])).toEqual([
      ['npm', ['run', 'build:gateway']],
      ['node', ['dist-gateway/middleware/runtime-gateway/main.js']],
      ['npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173']],
    ])
  })

  it('stops an already-started child when the second process fails', async () => {
    const killed: string[] = []
    const spawn = vi.fn()
      .mockReturnValueOnce({ kill: vi.fn(), exited: Promise.resolve(0) })
      .mockReturnValueOnce({ kill: vi.fn(() => killed.push('gateway')), exited: new Promise(() => undefined) })
      .mockImplementationOnce(() => { throw new Error('VITE_START_FAILED') })
    const stack = createDevStack({ spawn, probe: vi.fn(), onSignal: vi.fn() })
    await expect(stack.start()).rejects.toThrow('VITE_START_FAILED')
    expect(killed).toEqual(['gateway'])
  })
})
```

- [ ] **Step 2: Run the focused test and confirm failure**

Run:

```powershell
npx vitest run scripts/codex/dev-stack.test.ts
```

Expected: FAIL because `dev-stack.mjs` is missing.

- [ ] **Step 3: Implement the process supervisor**

Implement:

```js
export function createDevStack({
  spawn: spawnProcess = defaultSpawn,
  probe = defaultProbe,
  onSignal = defaultOnSignal,
}) {
  const children = []
  let stopping = false

  const stop = async () => {
    if (stopping) return
    stopping = true
    for (const child of [...children].reverse()) child.kill()
    await Promise.allSettled(children.map((child) => child.exited))
  }

  return Object.freeze({
    async start() {
      await spawnProcess('npm', ['run', 'build:gateway']).exited.then((code) => {
        if (code !== 0) throw new Error('GATEWAY_BUILD_FAILED')
      })
      try {
        children.push(spawnProcess('node', ['dist-gateway/middleware/runtime-gateway/main.js']))
        children.push(spawnProcess('npm', ['run', 'dev', '--', '--host', '127.0.0.1', '--port', '5173']))
        await waitForProbe('http://127.0.0.1:8081/healthz', probe)
        await waitForProbe('http://127.0.0.1:5173/', probe)
      } catch (error) {
        await stop()
        throw error
      }
      onSignal('SIGINT', stop)
      onSignal('SIGTERM', stop)
      return Object.freeze({
        webUrl: 'http://127.0.0.1:5173',
        gatewayUrl: 'http://127.0.0.1:8081',
      })
    },
    stop,
  })
}
```

The production `defaultSpawn` must use `shell: false`, map `npm` to `npm.cmd` on Windows, inherit stdout/stderr, and expose an `exited` Promise. `waitForProbe` polls for at most 30 seconds and never sleeps more than 250 ms between attempts.

- [ ] **Step 4: Add the package script**

Add:

```json
{
  "scripts": {
    "dev:stack": "node scripts/codex/dev-stack.mjs"
  }
}
```

- [ ] **Step 5: Run tests and a real startup smoke**

Run:

```powershell
npx vitest run scripts/codex/dev-stack.test.ts
npm run dev:stack
```

Expected:

- unit tests PASS;
- CLI reports both URLs;
- `http://127.0.0.1:8081/healthz` responds successfully;
- `http://127.0.0.1:5173/` responds successfully;
- Ctrl+C stops both child processes.

- [ ] **Step 6: Commit the stack supervisor**

```powershell
git add -- package.json scripts/codex/dev-stack.mjs scripts/codex/dev-stack.test.ts
git commit -m "feat: add deterministic local stack command"
```

## Task 4: Project Skills

**Files:**

- Create: `.agents/skills/robot-asset-onboarding/SKILL.md`
- Create: `.agents/skills/robot-asset-onboarding/references/acceptance.md`
- Create: `.agents/skills/opcua-runtime-diagnostics/SKILL.md`
- Create: `.agents/skills/release-verification/SKILL.md`
- Modify: `scripts/codex/validate-guidance.mjs`
- Modify: `scripts/codex/validate-guidance.test.ts`

**Interfaces:**

- Produces three discoverable repo Skills with exact trigger descriptions.
- Extends `validateGuidanceSnapshot` to validate Skill frontmatter and required references.

- [ ] **Step 1: Add failing Skill validation tests**

```ts
it('requires three focused repo Skills with unique names and descriptions', () => {
  const result = validateSkillSnapshot(new Map([
    ['.agents/skills/robot-asset-onboarding/SKILL.md', 'missing frontmatter'],
  ]))
  expect(result.ok).toBe(false)
  expect(result.errors).toContain(
    'Missing Skill: .agents/skills/opcua-runtime-diagnostics/SKILL.md',
  )
  expect(result.errors).toContain(
    '.agents/skills/robot-asset-onboarding/SKILL.md has invalid frontmatter.',
  )
})
```

- [ ] **Step 2: Run the test and verify it fails**

Run:

```powershell
npx vitest run scripts/codex/validate-guidance.test.ts
```

Expected: FAIL because `validateSkillSnapshot` does not exist.

- [ ] **Step 3: Extend the validator**

Require exact Skill paths and frontmatter:

```js
const REQUIRED_SKILLS = Object.freeze([
  '.agents/skills/robot-asset-onboarding/SKILL.md',
  '.agents/skills/opcua-runtime-diagnostics/SKILL.md',
  '.agents/skills/release-verification/SKILL.md',
])

const SKILL_FRONTMATTER = /^---\r?\nname: ([a-z0-9-]+)\r?\ndescription: (.+)\r?\n---\r?\n/u
```

Reject duplicate names, empty descriptions, descriptions over 512 UTF-8 bytes, and missing Robot acceptance reference.

- [ ] **Step 4: Write the Robot asset Skill**

Use this exact scope:

```md
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
```

The acceptance reference must require Project reload, actual geometry rendering, Joint motion, TCP consistency, and failure isolation.

- [ ] **Step 5: Write the OPC UA and release Skills**

The OPC UA Skill must:

- run `npm run build:gateway`;
- start/check the configured Gateway;
- inspect `/healthz`, `/readyz`, `/runtime/status`, and `/runtime/integration-diagnostics`;
- preserve saved Project configuration during disconnect/reconnect diagnosis;
- never issue an external OPC UA write.

The release Skill must:

- start with `git status --short`;
- select `verify:codex` scope from the changed paths;
- run the selected profile and `git diff --check`;
- report unverified runtime or deployment boundaries explicitly;
- stage only requested files.

- [ ] **Step 6: Validate Skills**

Run:

```powershell
npx vitest run scripts/codex/validate-guidance.test.ts
npm run verify:guidance
```

Expected: PASS with all three Skills detected.

- [ ] **Step 7: Commit the Skills**

```powershell
git add -- .agents/skills scripts/codex/validate-guidance.mjs scripts/codex/validate-guidance.test.ts
git commit -m "docs: add OpenDigitalTwin Codex skills"
```

## Task 5: Developer Documentation and Foundation Verification

**Files:**

- Create: `docs/developer/codex-workflows.md`
- Modify: `README.md`

**Interfaces:**

- Produces the human entry point for repository guidance, Skills, and deterministic commands.

- [ ] **Step 1: Write the workflow guide**

Document:

```md
# Codex Workflows

## Start the local stack
`npm run dev:stack`

## Run scoped verification
`npm run verify:codex -- --scope project-v5 --json`

## Available repository Skills
- `robot-asset-onboarding`
- `opcua-runtime-diagnostics`
- `release-verification`

## Safety boundary
Repository Skills and verification commands do not write to external OPC UA Servers or physical controllers.
```

Include the exact scope table for `guidance`, `project-v5`, `gateway`, `ui`, and `full`.

- [ ] **Step 2: Link the guide from README**

Add one concise developer-workflow link near the existing setup or verification section. Do not duplicate the guide in README.

- [ ] **Step 3: Run the complete foundation verification**

Run:

```powershell
npm run verify:guidance
npx vitest run scripts/codex
npm run verify:codex -- --scope project-v5 --json
git diff --check
```

Expected:

- all focused tests PASS;
- guidance validation exits `0`;
- Project V5 profile returns valid passing JSON;
- diff check has no output.

- [ ] **Step 4: Commit the documentation**

```powershell
git add -- README.md docs/developer/codex-workflows.md
git commit -m "docs: document Codex repository workflows"
```

## Plan Completion Gate

This plan is complete only when:

- the four `AGENTS.md` files are valid and discoverable;
- all three repo Skills validate;
- `npm run dev:stack` starts and cleanly stops Web and Gateway on Windows;
- `npm run verify:codex -- --scope project-v5 --json` returns passing structured output;
- no MCP, Project command, or external OPC UA write capability was added in this slice.
