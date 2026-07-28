# Codex-Friendly Application Implementation Roadmap

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this roadmap plan-by-plan. Do not execute later plans before their dependency gates pass.

**Goal:** Deliver the approved Codex-friendly OpenDigitalTwin design through four independently verifiable implementation plans.

**Architecture:** Repository guidance and deterministic commands establish the operating surface. A shared Browser-owned command authority then removes UI/operator divergence. A local STDIO MCP adapter reaches that authority through the Runtime Gateway. Sanitized diagnostics and a real end-to-end acceptance scenario complete the operational loop.

**Tech Stack:** Markdown, Node.js, TypeScript, React, Project V5, Runtime Gateway, MCP TypeScript SDK, Vitest, Playwright.

## Global Constraints

- Complete plans in the order below.
- Run each plan's completion gate before starting the next.
- Do not combine Project authority and Gateway authority.
- Do not add external OPC UA or PLC writes.
- Do not restore Legacy functionality.
- Do not introduce Git hooks in this delivery.
- Preserve unrelated user changes and stage only task-owned files.

## Delivery Order

1. [Codex Repository Foundation](./2026-07-28-codex-repository-foundation.md)
   - Adds root and nested guidance, repo Skills, deterministic verification, and cross-platform stack startup.
   - Has no dependency on later plans.

2. [Project V5 Command Authority](./2026-07-28-project-v5-command-authority.md)
   - Adds the closed command union, deterministic projector, preview/apply lifecycle, idempotency, and shared simulation commands.
   - Depends on the repository verification commands from Plan 1.

3. [Codex MCP Operator](./2026-07-28-codex-mcp-operator.md)
   - Adds the Gateway Operator API, Browser operator channel, local STDIO MCP Server, and project-scoped Codex configuration.
   - Depends on the shared authorities from Plan 2.

4. [Codex Diagnostics and Runtime Acceptance](./2026-07-28-codex-diagnostics-acceptance.md)
   - Adds sanitized diagnostic bundles and verifies the complete Browser-Gateway-MCP workflow.
   - Depends on the live MCP path from Plan 3.

## Cross-Plan Contract Freeze

The following names and behaviors are shared across plans and must not drift:

```text
ProjectCommandV1
ProjectCommandServiceV5.previewChange
ProjectCommandServiceV5.applyChange
SimulationCommandServiceV5.execute
OperatorRequestV1
OperatorResultV1
/operator/v1
project_preview_change
project_apply_change
simulation_execute
runtime_get_diagnostics
300000 ms preview lifetime
10 second Browser operator timeout
32 maximum pending operator requests
200 diagnostic events per process
```

If implementation evidence requires a contract change, update the approved design specification and every affected plan in one documentation commit before changing code.

## Approved Specification Coverage

| Specification area | Owning plan |
| --- | --- |
| Browser Project authority and shared UI/operator command service | Plan 2 |
| Eight read tools, two Project tools, one Simulation tool | Plan 3 |
| Closed eleven-command Project union | Plan 2 |
| Five-minute preview, exact apply, revision conflict, idempotency | Plan 2 |
| Simulation start, cancel, reset, and result observation | Plans 2 and 3 |
| READ and SIMULATION_WRITE annotations; EXTERNAL_WRITE excluded | Plan 3 |
| Common structured failures and bounded recovery actions | Plans 2 and 3 |
| Shared diagnostics and 200-event history | Plan 4 |
| Root and nested `AGENTS.md` guidance | Plan 1 |
| Three project Skills | Plan 1 |
| `dev:stack`, `verify:codex`, `demo:reset`, `mcp:smoke`, `diagnostics:bundle` | Plans 1, 3, and 4 |
| No initial Git hooks | Plans 1 and 4 |
| Contract, parity, safety, runtime, and OPC UA boundary tests | Plans 2, 3, and 4 |
| Embedded assistant, remote MCP, PLC writes, AI Joint inference, and Legacy remain excluded | All plans |

## Final Integrated Gate

After all four plans:

```powershell
npm run --silent verify:codex -- --scope full --json
npm run mcp:smoke
npm run diagnostics:bundle -- --sanitize
npm run demo:reset
git diff --check
```

Completion requires:

- all commands exit `0`;
- the structured verification result is `PASS`;
- MCP discovers exactly eleven tools;
- the acceptance Job reaches `SUCCEEDED`;
- diagnostics contain no unredacted test secrets;
- the working tree contains only intentional implementation changes.
