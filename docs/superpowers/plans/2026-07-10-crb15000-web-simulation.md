# CRB 15000 Web Robot Simulation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build and verify a browser-only industrial 3D simulator that uses all seven supplied CRB 15000 STEP links, animates six joints, imports equipment STEP files, supports cup pick/place and collision handling, and displays reusable red/yellow/green equipment stack lights.

**Architecture:** A React/Vite/R3F client loads preconverted GLB robot links and builds a manifest-driven joint hierarchy. The same OCCT WebAssembly importer runs in a worker for equipment STEP files, while Zustand owns transient simulation state and Dexie owns browser persistence. Joint rendering depends on a provider contract so a future server-side OPC UA gateway can stream six angles without changing robot, UI, or interaction modules.

**Tech Stack:** Node 22.15.1, npm 11.4.2, React 19.2.7, Vite 8.1.4, TypeScript 6.0.3, Three.js 0.185.1, React Three Fiber 9.6.1, Drei 10.7.7, React Three Rapier 2.2.0, Zustand 5.0.14, Dexie 4.4.4, occt-import-js 0.0.23, glTF Transform 4.4.1, Vitest 4.1.10, Playwright 1.61.1, Oxlint 1.73.0.

## Global Constraints

- Preserve the supplied `CRB15000_12kg-127_OmniCore_rev00_STEP_J` directory as the authoritative robot geometry.
- Use all seven source links: `LINK00` through `LINK06`.
- Request metre output from OCCT. Do not multiply `LINK05` by 25.4 after OCCT conversion; OCCT already reads its inch unit and converts it to metres.
- Use the exact CRB 15000-12/1.27 joint origins, axes, and limits in Task 3.
- Simulation mode must work with no backend and no network after dependencies and assets are installed.
- Do not modify, build, deploy, restart, transfer to, or write variables on the adjacent Automation Studio project or any PLC.
- The OPC UA boundary is read-only joint-frame ingestion through a future WebSocket gateway; direct browser `opc.tcp` is prohibited.
- Keep Three.js objects out of Zustand persistence and Dexie records; persist serializable transforms, metadata, and source bytes only.
- Use TDD for domain and behavior changes. Use Playwright for WebGL, WASM, IndexedDB, Rapier, and visual workflows that jsdom cannot prove.
- Keep Structured Text and PLC work out of this plan.
- Before UI coding, generate and approve both the 1440 x 900 desktop concept and 768 x 1024 narrow concept in Task 1.
- Every task ends with its targeted tests, a clean `git diff --check`, and a focused commit.

---

## Locked File Structure

```text
RobotSimWeb/
├── CRB15000_12kg-127_OmniCore_rev00_STEP_J/   # authoritative STEP source
├── docs/
│   ├── design/
│   │   ├── robot-sim-desktop-concept.png
│   │   ├── robot-sim-narrow-concept.png
│   │   └── robot-sim-visual-spec.md
│   └── superpowers/
│       ├── plans/2026-07-10-crb15000-web-simulation.md
│       └── specs/2026-07-10-robot-simulation-design.md
├── e2e/
│   ├── core-workflow.spec.ts
│   ├── equipment-import.spec.ts
│   ├── responsive.spec.ts
│   └── visual-fidelity.spec.ts
├── public/
│   └── models/robot/
│       ├── LINK00.glb ... LINK06.glb
│       └── asset-report.json
├── scripts/cad/
│   ├── convert-robot.ts
│   ├── occt-to-gltf.ts
│   ├── robot-asset-probe.test.ts
│   └── validate-robot-assets.ts
├── src/
│   ├── app/
│   │   ├── App.tsx
│   │   ├── AppShell.tsx
│   │   └── AppShell.test.tsx
│   ├── domain/
│   │   ├── equipment/
│   │   │   ├── equipment.ts
│   │   │   └── equipment.test.ts
│   │   └── robot/
│   │       ├── crb15000.ts
│   │       ├── joint-frame.ts
│   │       ├── joint-frame.test.ts
│   │       ├── kinematics.ts
│   │       └── kinematics.test.ts
│   ├── features/
│   │   ├── equipment/
│   │   │   ├── BuiltInEquipment.tsx
│   │   │   ├── EquipmentScene.tsx
│   │   │   ├── StackLight.tsx
│   │   │   ├── equipment-db.ts
│   │   │   ├── equipment-store.ts
│   │   │   └── equipment-store.test.ts
│   │   ├── import/
│   │   │   ├── ImportStepDialog.tsx
│   │   │   ├── StepImportClient.ts
│   │   │   ├── StepImportClient.test.ts
│   │   │   ├── detect-step-unit.ts
│   │   │   ├── detect-step-unit.test.ts
│   │   │   ├── occt-to-three.ts
│   │   │   └── step-import.worker.ts
│   │   ├── interaction/
│   │   │   ├── CollisionSystem.tsx
│   │   │   ├── EquipmentTransformControls.tsx
│   │   │   ├── GraspController.tsx
│   │   │   ├── interaction-store.ts
│   │   │   └── interaction-store.test.ts
│   │   ├── joints/
│   │   │   ├── JointInspector.tsx
│   │   │   ├── SimulationJointSource.ts
│   │   │   ├── keyframes.ts
│   │   │   ├── keyframes.test.ts
│   │   │   ├── robot-store.ts
│   │   │   └── robot-store.test.ts
│   │   ├── robot/
│   │   │   ├── RobotGripper.tsx
│   │   │   ├── RobotModel.tsx
│   │   │   └── RobotStatusOverlay.tsx
│   │   ├── scene/
│   │   │   ├── SceneCanvas.tsx
│   │   │   ├── SceneErrorBoundary.tsx
│   │   │   └── Workcell.tsx
│   │   └── ui/
│   │       ├── AssetTree.tsx
│   │       ├── EquipmentInspector.tsx
│   │       ├── EventRail.tsx
│   │       ├── InspectorPanel.tsx
│   │       ├── Timeline.tsx
│   │       └── TopBar.tsx
│   ├── lib/cad/occt-types.ts
│   ├── state/event-store.ts
│   ├── styles/global.css
│   ├── styles/tokens.css
│   ├── test/debug-bridge.ts
│   ├── test/setup.ts
│   ├── types/occt-import-js.d.ts
│   └── main.tsx
├── .env.test
├── .gitignore
├── .node-version
├── index.html
├── package.json
├── package-lock.json
├── playwright.config.ts
├── tsconfig.app.json
├── tsconfig.json
├── tsconfig.node.json
├── vite.config.ts
└── vitest.config.ts
```

---

### Task 1: Generate and Approve the Complete Visual Reference

**Files:**
- Create: `docs/design/robot-sim-desktop-concept.png`
- Create: `docs/design/robot-sim-narrow-concept.png`
- Create: `docs/design/robot-sim-visual-spec.md`

**Interfaces:**
- Consumes: Approved textual design in `docs/superpowers/specs/2026-07-10-robot-simulation-design.md`.
- Produces: The visual source of truth, exact design tokens, visible copy allow-list, icon inventory, and responsive rules consumed by Tasks 2, 5, and 10.

- [ ] **Step 1: Invoke the required Image Gen workflow and create the desktop concept**

Use the installed `imagegen` skill before calling Image Gen. Generate one complete 1440 x 900 industrial application screenshot with this exact brief:

```text
Create a production-ready 1440 x 900 desktop UI concept for “RobotSim”, an industrial 3D robot workcell simulator. This is the complete primary application screen, not a marketing page. Use a graphite #0B1118 background, #111B24 panels, #263440 borders, #E9F1F7 primary text, #8EA1B0 secondary text, #38BDF8 interaction accents, and semantic #EF4444 red, #F59E0B yellow, #22C55E green. Use compact Segoe UI / Inter-like typography, square-to-moderate 6px radii, restrained shadows, and no decorative gradients, pills, badges, hero copy, card grid, or fake metrics.

Layout: 48px top bar; 248px left Scene Assets rail; full-height central 3D viewport; 320px right Inspector; 128px bottom Timeline / Events rail. Top bar visible copy: “RobotSim”, “SIMULATION”, “GOOD”, “Import STEP”. Left rail: “Scene Assets”, expanded “Robot” with LINK00–LINK06, expanded “Equipment” with Cup 01, Cup 02, Machine 01. Center viewport: ABB GoFa-like six-axis gray/white/red robot on a clean industrial workbench, two cups, one machine cabinet, grid floor, one selected object outline, and a realistic three-lens red/yellow/green industrial stack light. Right Inspector: J1–J6 compact sliders and degree fields, Home, Reset, Save Pose, Open Gripper. Bottom rail: playback controls, two keyframes, and one collision event row. Controls and text must remain code-native in implementation. Make the 3D viewport the visual focus and keep chrome precise, dense, and readable.
```

- [ ] **Step 2: Generate the coordinated narrow concept**

Generate a fresh 768 x 1024 screenshot using the same colors, typography, objects, and copy. Keep the top bar and viewport visible; convert the asset tree and inspector into closed edge drawers; show the bottom rail as a collapsed sheet. Do not invent new component families or visible copy.

- [ ] **Step 3: Review and obtain explicit user approval**

Show both images. Record requested changes, regenerate rather than patching unreadable regions, and continue until the user explicitly accepts both images. Do not begin Task 2 before acceptance.

- [ ] **Step 4: Write the immutable visual specification**

Create `docs/design/robot-sim-visual-spec.md` with the exact palette above, the visible copy list below, the icon list, layout measurements, concept image paths, and the rule that no additional above-the-fold copy is permitted.

```markdown
# RobotSim Visual Specification

## Accepted References
- Desktop: `docs/design/robot-sim-desktop-concept.png` at 1440 x 900
- Narrow: `docs/design/robot-sim-narrow-concept.png` at 768 x 1024

## Visible Copy Allow-List
RobotSim; SIMULATION; GOOD; Import STEP; Scene Assets; Robot; Equipment;
LINK00; LINK01; LINK02; LINK03; LINK04; LINK05; LINK06; Cup 01; Cup 02;
Machine 01; Inspector; J1; J2; J3; J4; J5; J6; Home; Reset; Save Pose;
Open Gripper; Close Gripper; Timeline; Events.

## Tokens
- canvas: #0B1118
- panel: #111B24
- viewport: #081018
- border: #263440
- text: #E9F1F7
- muted: #8EA1B0
- accent: #38BDF8
- fault: #EF4444
- warning: #F59E0B
- running: #22C55E
- radius: 6px

## Icon Inventory
Upload, ChevronDown, Eye, EyeOff, Home, RotateCcw, Save, Play, Pause,
Square, Grip, PanelLeft, PanelRight, TriangleAlert.
All icons use the same 1.75px outline weight and 16px optical size.
```

- [ ] **Step 5: Commit the accepted design reference**

```powershell
git add docs/design
git diff --cached --check
git commit -m "design: approve industrial robot simulator interface"
```

Expected: one commit containing both accepted concepts and the visual spec.

---

### Task 2: Create the Tested React/Vite Application Foundation

**Files:**
- Create: `.gitignore`, `.node-version`, `package.json`, `package-lock.json`
- Create: `index.html`, `vite.config.ts`, `vitest.config.ts`
- Create: `tsconfig.json`, `tsconfig.app.json`, `tsconfig.node.json`
- Create: `src/main.tsx`, `src/app/App.tsx`, `src/app/AppShell.tsx`
- Create: `src/app/AppShell.test.tsx`, `src/test/setup.ts`
- Create: `src/styles/tokens.css`, `src/styles/global.css`

**Interfaces:**
- Consumes: Exact tokens and visible copy from Task 1.
- Produces: `App`, `AppShell`, test harness, build configuration, and five named layout regions used by later tasks.

- [ ] **Step 1: Write the failing shell test**

```tsx
// src/app/AppShell.test.tsx
import { render, screen } from '@testing-library/react'
import { describe, expect, it } from 'vitest'
import { AppShell } from './AppShell'

describe('AppShell', () => {
  it('renders the five industrial workstation regions', () => {
    render(<AppShell viewport={<div>3D viewport</div>} />)
    expect(screen.getByRole('banner')).toHaveTextContent('RobotSim')
    expect(screen.getByLabelText('Scene Assets')).toBeInTheDocument()
    expect(screen.getByLabelText('3D viewport')).toBeInTheDocument()
    expect(screen.getByLabelText('Inspector')).toBeInTheDocument()
    expect(screen.getByLabelText('Timeline and Events')).toBeInTheDocument()
  })
})
```

- [ ] **Step 2: Create the pinned package manifest and install**

Create `package.json` with `type: module`, Node/npm engines, and these scripts:

```json
{
  "name": "crb15000-robot-sim-web",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "engines": { "node": ">=22.15.1 <23", "npm": ">=11.4.2 <12" },
  "packageManager": "npm@11.4.2",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "build:e2e": "tsc -b && vite build --mode test",
    "preview": "vite preview",
    "lint": "oxlint .",
    "test": "vitest",
    "test:run": "vitest run",
    "test:coverage": "vitest run --coverage",
    "cad:convert": "tsx scripts/cad/convert-robot.ts",
    "cad:validate": "tsx scripts/cad/validate-robot-assets.ts",
    "test:e2e": "npm run build:e2e && playwright test",
    "verify": "npm run lint && npm run test:run && npm run cad:validate && npm run build"
  }
}
```

Run these exact installs:

```powershell
npm install --save-exact react@19.2.7 react-dom@19.2.7 three@0.185.1 @react-three/fiber@9.6.1 @react-three/drei@10.7.7 @react-three/rapier@2.2.0 zustand@5.0.14 dexie@4.4.4 dexie-react-hooks@4.4.0 occt-import-js@0.0.23 lucide-react@1.24.0
npm install --save-dev --save-exact vite@8.1.4 @vitejs/plugin-react@6.0.3 typescript@6.0.3 @types/node@22.20.1 @types/react@19.2.17 @types/react-dom@19.2.3 @types/three@0.185.1 vitest@4.1.10 @vitest/coverage-v8@4.1.10 jsdom@29.1.1 @testing-library/dom@10.4.1 @testing-library/react@16.3.2 @testing-library/jest-dom@6.9.1 @testing-library/user-event@14.6.1 fake-indexeddb@6.2.5 @playwright/test@1.61.1 oxlint@1.73.0 tsx@4.23.0 @gltf-transform/core@4.4.1
```

Expected: `package-lock.json` is generated with no peer-resolution error.

- [ ] **Step 3: Add strict TypeScript, Vite, and Vitest configuration**

Use `jsx: react-jsx`, `moduleResolution: Bundler`, `erasableSyntaxOnly: true`, `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true`, and `types: ["vite/client"]` in `tsconfig.app.json`. Include `src` in the app config and `vite.config.ts`, `vitest.config.ts`, `scripts`, and `playwright.config.ts` in the node config.

```ts
// vitest.config.ts
import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  test: {
    environment: 'jsdom',
    setupFiles: ['./src/test/setup.ts'],
    include: ['src/**/*.test.{ts,tsx}', 'scripts/**/*.test.ts'],
    coverage: { provider: 'v8', reporter: ['text', 'html'] },
  },
})
```

```ts
// src/test/setup.ts
import '@testing-library/jest-dom/vitest'
import 'fake-indexeddb/auto'
```

Set `.node-version` to `22.15.1`. Set `.gitignore` to exactly these generated paths while keeping source STEP and generated runtime GLBs trackable:

```gitignore
node_modules/
dist/
coverage/
playwright-report/
test-results/
*.log
.DS_Store
```

- [ ] **Step 4: Implement the real app shell**

```tsx
// src/app/AppShell.tsx
import type { ReactNode } from 'react'

interface AppShellProps {
  viewport: ReactNode
  assetTree?: ReactNode
  inspector?: ReactNode
  bottomRail?: ReactNode
}

export function AppShell({ viewport, assetTree, inspector, bottomRail }: AppShellProps) {
  return (
    <div className="app-shell">
      <header className="top-bar">
        <strong>RobotSim</strong><span>SIMULATION</span><span>GOOD</span>
        <button type="button">Import STEP</button>
      </header>
      <aside aria-label="Scene Assets" className="asset-rail">{assetTree}</aside>
      <main aria-label="3D viewport" className="viewport">{viewport}</main>
      <aside aria-label="Inspector" className="inspector">{inspector}</aside>
      <section aria-label="Timeline and Events" className="bottom-rail">{bottomRail}</section>
    </div>
  )
}
```

Implement `tokens.css` from Task 1 and use CSS Grid columns `248px minmax(0, 1fr) 320px`, rows `48px minmax(0, 1fr) 128px`. At widths below 960px, keep the viewport in the main grid and position side rails off-canvas behind drawer controls.

```tsx
// src/app/App.tsx
import { AppShell } from './AppShell'

export function App() {
  return <AppShell viewport={<div className="viewport-loading">Preparing 3D workcell…</div>} />
}
```

- [ ] **Step 5: Run the foundation checks**

```powershell
npm run test:run -- src/app/AppShell.test.tsx
npm run lint
npm run build
```

Expected: one passing shell test, no Oxlint diagnostics, and a successful Vite production build.

- [ ] **Step 6: Commit the foundation**

```powershell
git add .gitignore .node-version package.json package-lock.json index.html vite.config.ts vitest.config.ts tsconfig.json tsconfig.app.json tsconfig.node.json src
git diff --cached --check
git commit -m "build: scaffold tested robot simulator shell"
```

---

### Task 3: Convert the Seven STEP Links and Lock the CRB 15000 Kinematics

**Files:**
- Create: `src/lib/cad/occt-types.ts`, `src/types/occt-import-js.d.ts`
- Create: `src/domain/robot/crb15000.ts`
- Create: `scripts/cad/occt-to-gltf.ts`, `scripts/cad/convert-robot.ts`
- Create: `scripts/cad/robot-asset-probe.test.ts`, `scripts/cad/validate-robot-assets.ts`
- Generate: `public/models/robot/LINK00.glb` through `LINK06.glb`
- Generate: `public/models/robot/asset-report.json`
- Track: `CRB15000_12kg-127_OmniCore_rev00_STEP_J/*`

**Interfaces:**
- Produces: `CRB15000_DEFINITION`, `OcctResult`, `writeLinkGlb()`, seven runtime GLBs, and deterministic validation metadata.
- Consumed by: Tasks 4, 5, 8, and 9.

- [ ] **Step 1: Write the failing kinematic constants and asset-probe tests**

```ts
// scripts/cad/robot-asset-probe.test.ts
import { describe, expect, it } from 'vitest'
import { CRB15000_DEFINITION } from '../../src/domain/robot/crb15000'
import { probeStepLink } from './convert-robot'

describe('CRB15000 source CAD', () => {
  it('locks the 12/1.27 joint definition', () => {
    expect(CRB15000_DEFINITION.joints.map((joint) => joint.origin)).toEqual([
      [0, 0, 0.338], [0, 0, 0], [0, 0, 0.707],
      [0, 0, 0.110], [0.534, 0, 0], [0.101, 0, 0.080],
    ])
    expect(CRB15000_DEFINITION.joints.map((joint) => [joint.minDeg, joint.maxDeg])).toEqual([
      [-270, 270], [-180, 180], [-225, 85],
      [-180, 180], [-180, 180], [-270, 270],
    ])
  })

  it('lets OCCT normalize the inch LINK05 directly to metres', async () => {
    const probe = await probeStepLink('LINK05')
    expect(probe.bounds.min[0]).toBeCloseTo(0.40657, 4)
    expect(probe.bounds.min[1]).toBeCloseTo(-0.0935, 4)
    expect(probe.bounds.min[2]).toBeCloseTo(1.101, 4)
    expect(probe.bounds.max[0]).toBeCloseTo(0.602, 4)
    expect(probe.bounds.max[2]).toBeCloseTo(1.28775, 4)
  }, 30_000)
})
```

- [ ] **Step 2: Define exact robot data and OCCT result types**

```ts
// src/domain/robot/crb15000.ts
export type Vector3Tuple = readonly [number, number, number]

export interface RobotJointDefinition {
  id: 'J1' | 'J2' | 'J3' | 'J4' | 'J5' | 'J6'
  parentLink: `LINK0${number}`
  childLink: `LINK0${number}`
  origin: Vector3Tuple
  axis: Vector3Tuple
  minDeg: number
  maxDeg: number
}

export const CRB15000_DEFINITION = {
  id: 'CRB15000-12/1.27',
  baseLink: 'LINK00',
  joints: [
    { id: 'J1', parentLink: 'LINK00', childLink: 'LINK01', origin: [0, 0, 0.338], axis: [0, 0, 1], minDeg: -270, maxDeg: 270 },
    { id: 'J2', parentLink: 'LINK01', childLink: 'LINK02', origin: [0, 0, 0], axis: [0, 1, 0], minDeg: -180, maxDeg: 180 },
    { id: 'J3', parentLink: 'LINK02', childLink: 'LINK03', origin: [0, 0, 0.707], axis: [0, 1, 0], minDeg: -225, maxDeg: 85 },
    { id: 'J4', parentLink: 'LINK03', childLink: 'LINK04', origin: [0, 0, 0.110], axis: [1, 0, 0], minDeg: -180, maxDeg: 180 },
    { id: 'J5', parentLink: 'LINK04', childLink: 'LINK05', origin: [0.534, 0, 0], axis: [0, 1, 0], minDeg: -180, maxDeg: 180 },
    { id: 'J6', parentLink: 'LINK05', childLink: 'LINK06', origin: [0.101, 0, 0.080], axis: [1, 0, 0], minDeg: -270, maxDeg: 270 },
  ],
  toolRotationYRad: Math.PI / 2,
} as const
```

The values come from ROS-Industrial `abb_crb15000_support/urdf/crb15000_12_127_macro.xacro`; limits are cross-checked against ABB product specification 3HAC077390-001 Revision X. Keep attribution in a code comment and project README.

- [ ] **Step 3: Implement STEP probing and GLB writing**

In `convert-robot.ts`, initialize OCCT once, call `ReadStepFile(bytes, { linearUnit: 'meter', linearDeflectionType: 'bounding_box_ratio', linearDeflection: 0.001, angularDeflection: 0.5 })`, and fail when `success !== true` or the mesh list is empty.

Export `probeStepLink()` for tests and guard CLI execution with `if (import.meta.url === pathToFileURL(process.argv[1]!).href)` so importing the module never writes generated assets.

Use these zero-pose world mesh origins before writing each GLB:

```ts
export const LINK_WORLD_ORIGINS = {
  LINK00: [0, 0, 0],
  LINK01: [0, 0, 0.338],
  LINK02: [0, 0, 0.338],
  LINK03: [0, 0, 1.045],
  LINK04: [0, 0, 1.155],
  LINK05: [0.534, 0, 1.155],
  LINK06: [0.635, 0, 1.235],
} as const
```

`writeLinkGlb()` subtracts the corresponding world origin from every position. Group triangle indices by `brep_face.color ?? mesh.color ?? [0.68, 0.72, 0.74]`; `brep_face.first` and `last` are inclusive triangle numbers, so slice from `first * 3` through `(last + 1) * 3`. Create one glTF primitive per color with shared position/normal accessors and a material using metallic `0.05` and roughness `0.72`. Write binary GLB with `NodeIO` from `@gltf-transform/core`.

- [ ] **Step 4: Run the focused tests and confirm failure becomes success**

```powershell
npm run test:run -- scripts/cad/robot-asset-probe.test.ts
```

Expected: two passing tests. The LINK05 test proves no manual 25.4 multiplier is applied.

- [ ] **Step 5: Convert all seven links and record deterministic evidence**

```powershell
npm run cad:convert
```

Expected source probe minima/maxima in metres before local-origin subtraction:

| Link | Vertices | Triangles | Min XYZ | Max XYZ |
|---|---:|---:|---|---|
| LINK00 | 4,527 | 5,228 | `[-0.1418,-0.1000,0]` | `[0.1000,0.1000,0.2140]` |
| LINK01 | 3,798 | 5,544 | `[-0.0800,-0.09515,0.2149]` | `[0.0800,0.1116,0.41811]` |
| LINK02 | 8,351 | 9,970 | `[-0.08076,-0.20365,0.25727]` | `[0.08076,-0.0863,1.11353]` |
| LINK03 | 6,681 | 9,883 | `[-0.0650,-0.0850,0.98003]` | `[0.0960,0.1100,1.20757]` |
| LINK04 | 10,330 | 11,162 | `[0.0970,-0.0528,1.10218]` | `[0.58478,0.1330,1.20782]` |
| LINK05 | 9,056 | 12,092 | `[0.40657,-0.0935,1.1010]` | `[0.6020,0.0745,1.28775]` |
| LINK06 | 9,182 | 11,476 | `[0.6024,-0.05250,1.18246]` | `[0.6350,0.05253,1.28754]` |

Allow a 2% triangle-count tolerance for library-level tessellation drift; bounds tolerance is 0.5 mm.

- [ ] **Step 6: Validate the generated GLBs**

`validate-robot-assets.ts` must load every GLB with `NodeIO`, require non-empty position and index accessors, verify finite local bounds, reconstruct world bounds using `LINK_WORLD_ORIGINS`, and compare against the table above. It must also assert that the union longest axis is between 1.2 m and 1.5 m and that LINK02, LINK04, LINK05, and LINK06 retain at least two material colors where present in source data.

```powershell
npm run cad:validate
```

Expected: `7 link assets valid; 0 errors; 0 warnings`.

- [ ] **Step 7: Commit source CAD, converter, manifest, reports, and GLBs**

```powershell
git add CRB15000_12kg-127_OmniCore_rev00_STEP_J public/models/robot scripts/cad src/domain/robot/crb15000.ts src/lib/cad src/types/occt-import-js.d.ts package.json package-lock.json
git diff --cached --check
git commit -m "feat: convert CRB 15000 STEP links for web runtime"
```

---

### Task 4: Implement Joint Frames, the Simulation Source, and Kinematic Rig

**Files:**
- Create: `src/domain/robot/joint-frame.ts`, `src/domain/robot/joint-frame.test.ts`
- Create: `src/domain/robot/kinematics.ts`, `src/domain/robot/kinematics.test.ts`
- Create: `src/features/joints/SimulationJointSource.ts`
- Create: `src/features/joints/robot-store.ts`, `src/features/joints/robot-store.test.ts`

**Interfaces:**
- Produces: `JointFrame`, `JointAngleSource`, `createRobotRig()`, `setRigAngles()`, `SimulationJointSource`, and `useRobotStore`.
- Consumed by: Tasks 5, 6, 9, and 10.

- [ ] **Step 1: Write failing frame and hierarchy tests**

```ts
it('holds the last good pose when a frame is bad or older than 1000 ms', () => {
  const state = reduceJointFrame(initialRobotState, goodFrame([10, 20, 30, 40, 50, 60], 1000), 1000)
  expect(reduceJointFrame(state, { ...goodFrame([0, 0, 0, 0, 0, 0], 1001), quality: 'BAD' }, 1001).anglesDeg).toEqual(state.anglesDeg)
  expect(reduceJointFrame(state, goodFrame([0, 0, 0, 0, 0, 0], 1000), 2001).sourceQuality).toBe('STALE')
})

it('rejects malformed joint tuples before state changes', () => {
  expect(() => validateJointFrame({ anglesDeg: [0, 0, 0] as never, timestampMs: 1, quality: 'GOOD' })).toThrow('exactly six')
  expect(() => validateJointFrame({ anglesDeg: [0, 0, Number.NaN, 0, 0, 0] as const, timestampMs: 1, quality: 'GOOD' })).toThrow('finite')
})

it('moves only the selected joint subtree', () => {
  const rig = createRobotRig(CRB15000_DEFINITION)
  setRigAngles(rig, [0, 0, 0, 0, 90, 0])
  rig.root.updateMatrixWorld(true)
  expect(rig.linkSlots.LINK04.getWorldPosition(new Vector3()).toArray()).toEqual([0, 0, 1.155])
  expect(rig.linkSlots.LINK06.getWorldPosition(new Vector3()).x).not.toBeCloseTo(0.635, 4)
})
```

- [ ] **Step 2: Define the frame contract and validation**

```ts
export type JointAnglesDeg = readonly [number, number, number, number, number, number]
export type JointQuality = 'GOOD' | 'UNCERTAIN' | 'BAD' | 'STALE'

export interface JointFrame {
  anglesDeg: JointAnglesDeg
  timestampMs: number
  quality: JointQuality
}

export interface JointAngleSource {
  readonly mode: 'simulation' | 'opcua'
  connect(): Promise<void>
  disconnect(): Promise<void>
  subscribe(listener: (frame: JointFrame) => void): () => void
}
```

Implement `validateJointFrame`, `clampJointAngles`, and `reduceJointFrame`. Reject non-finite values or an array length other than six. Clamp good simulation frames to manifest limits. Treat age `> 1000` ms as stale.

- [ ] **Step 3: Build the Three.js rig without WebGL**

`createRobotRig()` creates a root, base link slot, six nested `Group` joint pivots, six child-link slots, and a tool frame. Set each group position from the relative origin and rotate with `Quaternion.setFromAxisAngle(axis, degToRad(angle))`. Rotate the tool frame by `Math.PI / 2` around Y.

- [ ] **Step 4: Implement simulation source and Zustand store**

`SimulationJointSource` owns no React state. It publishes on explicit `setAngles()` calls and on animation ticks from Task 6. `useRobotStore` exposes stable scalar selectors and actions `setJoint`, `applyFrame`, `home`, `reset`, `setPlaying`, and `setGripperOpen`.

- [ ] **Step 5: Run focused tests**

```powershell
npm run test:run -- src/domain/robot/joint-frame.test.ts src/domain/robot/kinematics.test.ts src/features/joints/robot-store.test.ts
```

Expected: all frame, limit, quality, hierarchy, and store tests pass.

- [ ] **Step 6: Commit**

```powershell
git add src/domain/robot src/features/joints
git diff --cached --check
git commit -m "feat: add manifest-driven joint simulation core"
```

---

### Task 5: Render the Complete Workcell and STEP-Derived Robot

**Files:**
- Create: `src/features/scene/SceneCanvas.tsx`, `src/features/scene/SceneErrorBoundary.tsx`, `src/features/scene/Workcell.tsx`
- Create: `src/features/robot/RobotModel.tsx`, `src/features/robot/RobotGripper.tsx`, `src/features/robot/RobotStatusOverlay.tsx`
- Modify: `src/app/App.tsx`, `src/app/AppShell.tsx`

**Interfaces:**
- Consumes: `CRB15000_DEFINITION`, GLBs, `createRobotRig`, and `useRobotStore`.
- Produces: `SceneCanvas`, `RobotModel`, and a registered `toolFrame`/link-slot map for interaction tasks.

- [ ] **Step 1: Add a failing DOM-level canvas fallback test**

Test that `SceneErrorBoundary` renders `3D renderer unavailable` with the original error message and a retry button when a child throws. This is the jsdom proof that WebGL failure does not produce a blank application.

- [ ] **Step 2: Implement `RobotModel` with fixed asset URLs**

Use `useLoader(GLTFLoader, ['/models/robot/LINK00.glb', ... '/models/robot/LINK06.glb'])`. Create one rig with `useMemo`, clone each loaded scene once, attach LINK00 to `baseSlot` and LINK01–LINK06 to their named link slots, and add the rig root with `<primitive object={rig.root} />`. Subscribe to the six scalar angles and call `setRigAngles` in `useLayoutEffect`.

- [ ] **Step 3: Build the workcell scene**

`SceneCanvas` uses `<Canvas camera={{ position: [2.2, 1.8, 1.7], fov: 42 }} dpr={[1, 2]} shadows>` and wraps `Workcell` in `<Suspense>` and `<Physics gravity={[0, 0, 0]}>`. `Workcell` adds restrained ambient/key lights, grid, floor, a workbench with top at Z `1.08`, OrbitControls, RobotModel, and the tool-frame gripper.

- [ ] **Step 4: Add deterministic loading and error states**

Show a progress overlay while GLBs load. A missing link path must identify the exact LINK id and keep joint controls disabled. `SceneErrorBoundary` provides retry by remounting the scene.

- [ ] **Step 5: Verify in the built-in browser**

Run `npm run dev -- --host 127.0.0.1`, open the page through the Browser/IAB tool, and inspect the zero pose. Capture a screenshot and confirm all seven supplied link shapes form one robot with preserved colors and no link separation.

- [ ] **Step 6: Run checks and commit**

```powershell
npm run test:run
npm run build
git add src/app src/features/scene src/features/robot
git diff --cached --check
git commit -m "feat: render STEP-derived CRB 15000 workcell"
```

---

### Task 6: Add Joint Controls, Poses, Keyframes, and Playback

**Files:**
- Create: `src/features/joints/keyframes.ts`, `src/features/joints/keyframes.test.ts`
- Create: `src/features/joints/JointInspector.tsx`
- Create: `src/features/ui/Timeline.tsx`
- Modify: `src/features/joints/robot-store.ts`, `src/app/App.tsx`

**Interfaces:**
- Produces: `RobotKeyframe`, `sampleTimeline()`, `JointInspector`, and `Timeline`.
- Consumed by: collision auto-pause and E2E tasks.

- [ ] **Step 1: Write failing interpolation and inspector tests**

```ts
expect(sampleTimeline([
  { id: 'a', anglesDeg: [0, 0, 0, 0, 0, 0], durationMs: 1000, easing: 'linear' },
  { id: 'b', anglesDeg: [100, 20, 0, 0, 0, 0], durationMs: 1000, easing: 'linear' },
], 500).anglesDeg).toEqual([50, 10, 0, 0, 0, 0])
```

Render `JointInspector`, change the J3 numeric input to `-226`, and assert the visible value becomes `-225` and the store receives the clamped tuple.

- [ ] **Step 2: Implement timeline math**

Define `RobotKeyframe` with `id`, `name`, `anglesDeg`, `durationMs`, and `easing: 'linear' | 'easeInOut'`. Implement pure timeline duration and sampling functions. Keep values in degrees until `setRigAngles` converts them.

- [ ] **Step 3: Implement controls and playback**

Render six labeled range inputs plus numeric fields using manifest limits. Add Home, Reset, Save Pose, Play, Pause, Stop, Open Gripper, and Close Gripper controls. A requestAnimationFrame loop samples the active timeline and calls `SimulationJointSource.setAngles`; cancel it on unmount, pause, stop, collision, and bad/stale source quality.

Home sets the exact all-zero joint pose. Reset stops playback, clears unsaved keyframes and transient collision state, opens the gripper, and then applies Home.

- [ ] **Step 4: Run tests and browser interaction check**

```powershell
npm run test:run -- src/features/joints
npm run build
```

In Browser/IAB, jog J1–J6 separately and confirm each visible subtree moves while upstream links remain fixed. Save two poses and play them.

- [ ] **Step 5: Commit**

```powershell
git add src/features/joints src/features/ui/Timeline.tsx src/app/App.tsx
git diff --cached --check
git commit -m "feat: add six-axis controls and pose playback"
```

---

### Task 7: Add Equipment Records, Persistence, Cups, and Stack Lights

**Files:**
- Create: `src/domain/equipment/equipment.ts`, `src/domain/equipment/equipment.test.ts`
- Create: `src/features/equipment/equipment-db.ts`, `src/features/equipment/equipment-store.ts`, `src/features/equipment/equipment-store.test.ts`
- Create: `src/features/equipment/BuiltInEquipment.tsx`, `src/features/equipment/EquipmentScene.tsx`, `src/features/equipment/StackLight.tsx`
- Modify: `src/features/scene/Workcell.tsx`, `src/app/App.tsx`

**Interfaces:**
- Produces: `EquipmentRecord`, `EquipmentStatus`, `STATUS_LIGHTS`, `equipmentDb`, `useEquipmentStore`, built-in scene assets, and `StackLight`.
- Consumed by: import, inspector, interaction, and E2E tasks.

- [ ] **Step 1: Write failing status and persistence tests**

```ts
expect(STATUS_LIGHTS.RUNNING).toEqual({ red: false, yellow: false, green: true })
expect(STATUS_LIGHTS.WARNING).toEqual({ red: false, yellow: true, green: false })
expect(STATUS_LIGHTS.FAULT).toEqual({ red: true, yellow: false, green: false })
expect(STATUS_LIGHTS.OFF).toEqual({ red: false, yellow: false, green: false })
```

With fake IndexedDB, save an imported equipment record containing source bytes and a transform, recreate the store, call `hydrate()`, and assert the same id, status, bytes length, and transform are restored.

Also force `equipmentDb.open()` to reject and assert hydration retains all built-in records in memory while setting `persistenceStatus` to `memory-only` and exposing one warning.

- [ ] **Step 2: Define serializable equipment data**

```ts
export type EquipmentStatus = 'OFF' | 'RUNNING' | 'WARNING' | 'FAULT'
export interface SerializableTransform {
  position: [number, number, number]
  quaternion: [number, number, number, number]
  scale: [number, number, number]
}
export interface EquipmentRecord {
  id: string
  name: string
  kind: 'cup' | 'machine' | 'imported'
  status: EquipmentStatus
  transform: SerializableTransform
  graspable: boolean
  collisionHalfExtents: [number, number, number]
  stackLightAnchor: [number, number, number] | null
  sourceBytes?: ArrayBuffer
}
```

- [ ] **Step 3: Implement Dexie and store hydration**

Create schema version 1 with `equipment: '&id, kind, status, name'` and `scene: '&key'`. Persist records on explicit store actions. Never put `Object3D`, `Geometry`, `Material`, Worker, or Rapier handles in either layer.

Catch IndexedDB open/write failures, preserve the current in-memory session, and set `persistenceStatus: 'memory-only'`; do not reject App initialization.

- [ ] **Step 4: Create real built-in assets**

Seed exactly three records when the database is empty:

- `Cup 01` at `[0.75, 0.00, 1.15]`, graspable, green.
- `Cup 02` at `[0.72, -0.18, 1.15]`, graspable, yellow.
- `Machine 01` at `[0.92, 0.35, 1.28]`, not graspable, green, with stack-light anchor `[0, 0, 0.32]`.

Build cups from an open-top lathed profile with a glass/steel material and a visible blue water disk that does not simulate fluid. Build Machine 01 as a restrained steel cabinet.

Render `EquipmentScene` inside `Workcell` and invoke store hydration once from `App`. Keep hydration idempotent under React StrictMode.

- [ ] **Step 5: Implement the reusable industrial stack light**

Render the base, stem, separators, and red/yellow/green translucent cylinders. Active lenses use emissive intensity `2.4`; inactive intensity is `0.08`. Limit point-light range to `0.45 m` and intensity to `0.4` so status remains readable without washing out the viewport.

- [ ] **Step 6: Run tests, inspect states, and commit**

```powershell
npm run test:run -- src/domain/equipment src/features/equipment
npm run build
```

Use Browser/IAB to set Machine 01 through OFF, RUNNING, WARNING, and FAULT and visually verify exactly one active lens except OFF.

```powershell
git add src/domain/equipment src/features/equipment src/features/scene/Workcell.tsx src/app/App.tsx
git diff --cached --check
git commit -m "feat: add persistent equipment and stack lights"
```

---

### Task 8: Import Equipment STEP Files in a Reusable Web Worker

**Files:**
- Create: `src/features/import/detect-step-unit.ts`, `src/features/import/detect-step-unit.test.ts`
- Create: `src/features/import/step-import.worker.ts`, `src/features/import/StepImportClient.ts`, `src/features/import/StepImportClient.test.ts`
- Create: `src/features/import/occt-to-three.ts`, `src/features/import/ImportStepDialog.tsx`
- Modify: `src/features/equipment/equipment-store.ts`, `src/features/equipment/EquipmentScene.tsx`, `src/app/App.tsx`

**Interfaces:**
- Produces: `detectStepUnit()`, `StepImportClient.import()`, `StepImportClient.cancel()`, `createThreeGroupFromOcct()`, and `ImportStepDialog`.
- Consumes: `OcctResult`, `EquipmentRecord`, and persistence actions.

- [ ] **Step 1: Write failing unit-detector and cancellation tests**

Use short ASCII STEP header/data strings containing `SI_UNIT(.MILLI.,.METRE.)`, `SI_UNIT($,.METRE.)`, and `CONVERSION_BASED_UNIT('INCH', ...)`; expect `millimeter`, `meter`, and `inch`. Expect `unknown` for a unitless string.

Mock Worker and assert `cancel()` terminates the active worker, rejects with `DOMException` name `AbortError`, and creates a new worker on the next import.

- [ ] **Step 2: Declare OCCT CommonJS/WASM types and worker protocol**

```ts
type StepWorkerRequest = {
  kind: 'import-step'
  bytes: Uint8Array
  options: { linearUnit: 'meter'; linearDeflectionType: 'bounding_box_ratio'; linearDeflection: 0.001; angularDeflection: 0.5 }
}
type StepWorkerResponse =
  | { kind: 'success'; result: OcctResult }
  | { kind: 'error'; message: string }
```

In the worker, import `createOcct` plus `occt-import-js/dist/occt-import-js.wasm?url`, initialize once with `locateFile`, and call synchronous `ReadStepFile` only inside the worker. Transfer the source `ArrayBuffer` into the worker.

- [ ] **Step 3: Implement result-to-Three conversion**

For each OCCT mesh, create BufferGeometry position, normal, and index attributes. Group face indices by color as in Task 3 and add geometry groups with one MeshStandardMaterial per color. Compute bounds and center. Return `{ group, bounds, dispose }`; `dispose()` releases every geometry and material.

- [ ] **Step 4: Implement the import dialog**

Accept `.step,.stp`, reject files over 100 MiB, show an indeterminate conversion progress state, and expose Cancel. After parsing, show detected unit, metre dimensions, name, scale, origin mode, graspable toggle, collision half extents, and stack-light toggle. Known STEP units are read-only; unknown units require a source-unit selection and apply one explicit post-import scale factor.

On confirm, persist source bytes and serializable metadata, keep the OCCT result only in the transient geometry cache, close the dialog, and select the new asset.

When stack light is enabled, default its local anchor to `[0, 0, bounds.size[2] / 2 + 0.18]` after centering the imported geometry; the Equipment Inspector can move it later.

- [ ] **Step 5: Run unit and real-browser import checks**

```powershell
npm run test:run -- src/features/import
npm run build
```

Use Browser/IAB to upload `CRB15000_12kg-127_OmniCore_rev00_STEP_J/CRB15000_12kg-127_Omnicore_rev00_LINK00_CAD.step` as an equipment test asset. Confirm the viewport stays responsive, the preview reports approximately `0.242 x 0.200 x 0.214 m`, and cancel/retry both work.

- [ ] **Step 6: Commit**

```powershell
git add src/features/import src/features/equipment src/app/App.tsx src/types/occt-import-js.d.ts
git diff --cached --check
git commit -m "feat: import and persist equipment STEP assets"
```

---

### Task 9: Add Selection, Transform Controls, Rapier Collision, and Gripper Pick/Place

**Files:**
- Create: `src/features/interaction/interaction-store.ts`, `src/features/interaction/interaction-store.test.ts`
- Create: `src/features/interaction/EquipmentTransformControls.tsx`
- Create: `src/features/interaction/CollisionSystem.tsx`, `src/features/interaction/GraspController.tsx`
- Modify: `src/features/equipment/EquipmentScene.tsx`, `src/features/robot/RobotModel.tsx`, `src/features/robot/RobotGripper.tsx`
- Create: `src/state/event-store.ts`

**Interfaces:**
- Produces: selection state, collision pair state, grasp candidates, `heldEquipmentId`, `gripOffset`, and timestamped events.
- Consumes: robot link slots/tool frame, equipment transforms, and `setPlaying(false)`.

- [ ] **Step 1: Write failing interaction reducer tests**

Test these exact transitions:

1. Enter candidate Cup 01 → close gripper → Cup 01 becomes held.
2. Move tool transform → release → returned world transform equals `toolWorld * gripOffset`.
3. Collision enter → pair is active, one event is appended, playback becomes false.
4. Collision exit → outline is removed but the event remains.
5. Remove held asset → release occurs before removal and no held id remains.
6. Close while one item is already held → the original held id remains and no second item attaches.

- [ ] **Step 2: Implement ray selection and transform controls**

Equipment mesh click stops propagation and selects its id. Empty viewport click clears selection. Drei TransformControls writes position/quaternion/scale to the store on `objectChange`; disable OrbitControls while dragging. Do not expose robot-link transform controls.

- [ ] **Step 3: Synchronize kinematic Rapier sensors**

Create one `RigidBody type="kinematicPosition"` plus `CuboidCollider sensor` per robot link and equipment item. On each physics step, decompose the corresponding render object's world matrix and call `setNextKinematicTranslation` and `setNextKinematicRotation`. Use generated local bounds for robot links and stored half extents for equipment.

Collision filtering must allow robot↔equipment and robot↔workcell, exclude adjacent robot self-pairs, and exclude the gripper grasp sensor from collision events. Collision callbacks update the interaction and event stores. Active collision objects receive the concept's red outline.

- [ ] **Step 4: Implement deterministic grasp behavior**

Use a gripper sensor centered `0.09 m` along tool-local Z after the tool-frame rotation, with half extents `[0.10, 0.08, 0.10]`. Closing chooses the nearest graspable candidate, computes `inverse(toolWorld) * equipmentWorld`, and stores that offset. Render the held item under the tool frame with R3F `createPortal`. Opening computes the new world transform and snaps a vertical gap of at most 2 mm to the workbench top.

- [ ] **Step 5: Run tests and manual core flow**

```powershell
npm run test:run -- src/features/interaction
npm run build
```

In Browser/IAB: select Cup 01, close gripper at the seeded zero pose, jog J1 and J5, verify the cup follows, open the gripper, then move another item into a robot link and verify red outline, event row, and playback pause.

- [ ] **Step 6: Commit**

```powershell
git add src/features/interaction src/features/equipment src/features/robot src/state
git diff --cached --check
git commit -m "feat: add collision-aware robot pick and place"
```

---

### Task 10: Complete the Industrial UI and Responsive States

**Files:**
- Create: `src/features/ui/TopBar.tsx`, `src/features/ui/AssetTree.tsx`
- Create: `src/features/ui/InspectorPanel.tsx`, `src/features/ui/EquipmentInspector.tsx`
- Create: `src/features/ui/EventRail.tsx`
- Modify: `src/features/ui/Timeline.tsx`, `src/app/AppShell.tsx`, `src/app/App.tsx`
- Modify: `src/styles/tokens.css`, `src/styles/global.css`

**Interfaces:**
- Produces: the accepted desktop and narrow UI with working controls and no inert actions.
- Consumes: all feature stores, ImportStepDialog, SceneCanvas, JointInspector, and Timeline.

- [ ] **Step 1: Write behavior tests for the panels**

Test that selecting the robot shows six joints, selecting equipment shows transform/status/graspable/light controls, changing status updates the store, Import STEP opens the dialog, drawer buttons toggle at narrow width, and event rows render the collision pair and timestamp.

- [ ] **Step 2: Implement the exact visible copy and icon inventory**

Use only the allow-listed primary copy from Task 1 except dynamic asset names, values, errors, and event messages required by the workflow. Use Lucide icons from the approved inventory at 16px and 1.75px stroke. Give every icon-only button an accessible label and tooltip.

- [ ] **Step 3: Implement desktop layout fidelity**

Match the accepted 1440 x 900 reference: top bar 48px, left rail 248px, right inspector 320px, bottom rail 128px, and central viewport filling the remainder. Deliberately set control font sizes, weights, line heights, focus rings, selected rows, disabled states, and scrollbar treatment.

- [ ] **Step 4: Implement the 768 x 1024 state**

At `< 960px`, keep the top bar and viewport, use left/right edge drawers, collapse the bottom rail to a sheet, and prevent viewport overflow. Preserve access to Import STEP, joints, gripper, status, and playback.

- [ ] **Step 5: Run DOM tests, browser workflow, and accessibility pass**

```powershell
npm run test:run
npm run lint
npm run build
```

Use Browser/IAB to keyboard-tab through the full workflow, verify focus visibility, open/close drawers, and exercise every visible button. Remove any inert or duplicate control.

- [ ] **Step 6: Commit**

```powershell
git add src/app src/features/ui src/styles
git diff --cached --check
git commit -m "feat: finish responsive industrial simulator UI"
```

---

### Task 11: Add Production E2E Coverage and a Read-Only Debug Bridge

**Files:**
- Create: `.env.test`, `playwright.config.ts`
- Create: `src/test/debug-bridge.ts`
- Create: `e2e/core-workflow.spec.ts`, `e2e/equipment-import.spec.ts`, `e2e/responsive.spec.ts`
- Modify: `src/app/App.tsx`, `package.json`, `package-lock.json`

**Interfaces:**
- Produces: deterministic browser evidence for the complete workflow.
- Consumes: public UI and an E2E-only read-only snapshot enabled by `VITE_E2E=1`.

- [ ] **Step 1: Configure production-preview Playwright**

```ts
// playwright.config.ts
import { defineConfig, devices } from '@playwright/test'

export default defineConfig({
  testDir: './e2e',
  fullyParallel: false,
  use: {
    baseURL: 'http://127.0.0.1:4173',
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    ...devices['Desktop Chrome'],
  },
  webServer: {
    command: 'npm run preview -- --host 127.0.0.1 --port 4173',
    url: 'http://127.0.0.1:4173',
    reuseExistingServer: !process.env.CI,
  },
})
```

Set `.env.test` to `VITE_E2E=1`. Install Chromium with `npx playwright install chromium`.

- [ ] **Step 2: Add the guarded read-only snapshot**

When `import.meta.env.VITE_E2E === '1'`, expose `window.__ROBOT_SIM_DEBUG__.snapshot()` returning plain JSON only: joint angles, source quality, selected id, held id, active collision pairs, equipment records without source bytes, link world positions, and tool world transform. Do not expose mutation methods.

- [ ] **Step 3: Write the complete core workflow**

`core-workflow.spec.ts` must:

1. Wait for all seven robot links.
2. Change each joint through the UI and assert the debug snapshot angle.
3. Save two keyframes, play, pause, and stop.
4. Close the gripper on Cup 01, jog J1, assert held id and changed cup transform, and release.
5. Trigger the deterministic collision setup, assert red outline/event row/playback pause.
6. Set Machine 01 to OFF, RUNNING, WARNING, and FAULT and assert the snapshot plus one active lens.

- [ ] **Step 4: Write equipment import and persistence workflow**

Upload LINK00 as the fixture, assert preview dimensions within 1 mm, name it `Imported Base Fixture`, confirm, reload, and assert the asset tree and IndexedDB-restored record. Delete it, reload again, and assert it remains deleted. Also test a corrupt `.step` byte buffer leaves the existing scene unchanged and displays an actionable error.

- [ ] **Step 5: Write responsive workflow**

Run at 768 x 1024. Assert no horizontal document overflow, both side drawers open and close, joint/gripper/status/import actions remain reachable, and the bottom sheet expands without covering the top bar.

- [ ] **Step 6: Execute and commit**

```powershell
npm run test:e2e
git add .env.test playwright.config.ts e2e src/test/debug-bridge.ts src/app/App.tsx package.json package-lock.json
git diff --cached --check
git commit -m "test: cover complete robot simulator browser workflows"
```

Expected: all Playwright tests pass on production preview.

---

### Task 12: Run Visual Fidelity, Documentation, and Final Completion Audit

**Files:**
- Create: `e2e/visual-fidelity.spec.ts`
- Create: `docs/verification/fidelity-ledger.md`
- Create: `docs/verification/completion-audit.md`
- Create: `README.md`, `THIRD_PARTY_LICENSES.md`
- Modify: any implementation file with a verified mismatch

**Interfaces:**
- Produces: final visual, functional, asset, license, and requirement evidence.

- [ ] **Step 1: Add deterministic screenshot capture**

Capture desktop at 1440 x 900 and narrow at 768 x 1024 after waiting for fonts, GLBs, worker hydration, and two animation frames. Disable nonessential motion with `prefers-reduced-motion` while retaining the selected/collision/status states represented in the accepted concepts.

- [ ] **Step 2: Compare accepted concepts and current screenshots directly**

Use `view_image` on both accepted concept files and both latest implementation screenshots in the same QA pass. Inspect and record at least these comparison points:

1. visible copy and ordering;
2. grid dimensions and first-viewport balance;
3. typography and control density;
4. exact palette and semantic lights;
5. robot/cup/machine asset treatment;
6. borders, radii, and container model;
7. icons and alignment;
8. desktop and narrow responsive behavior.

Fix every agency-review-level mismatch and recapture until no material mismatch remains. Record mismatch, concept evidence, render evidence, and fix in `fidelity-ledger.md`.

- [ ] **Step 3: Run above-the-fold copy and icon diffs**

Compare the rendered visible strings and icons to `docs/design/robot-sim-visual-spec.md`. Dynamic values, asset names, diagnostics, and event rows are the only allowed additions. Fix or explicitly justify every difference in the fidelity ledger.

- [ ] **Step 4: Write operational documentation and licenses**

`README.md` must include Node/npm prerequisites, install, CAD conversion, dev, test, build, preview, browser-only persistence behavior, equipment import, simulation controls, source geometry attribution, ROS-Industrial kinematic attribution, OPC UA future gateway contract, troubleshooting, and the explicit no-PLC-write safety boundary.

`THIRD_PARTY_LICENSES.md` must include occt-import-js LGPL-2.1 and its distributed OCCT notices, ROS-Industrial ABB Apache-2.0 attribution for numeric kinematic data, and a table of every direct runtime dependency with the exact version from `package-lock.json`, its license identifier, and its canonical repository URL.

- [ ] **Step 5: Run the complete verification matrix**

```powershell
npm ci
npm run cad:convert
npm run cad:validate
npm run lint
npm run test:coverage
npm run build
npm run test:e2e
git diff --check
```

Expected:

- seven source STEP links convert and validate;
- zero asset errors and zero asset warnings;
- all Vitest tests pass with coverage report produced;
- Oxlint has zero diagnostics;
- production build succeeds;
- all Playwright workflows and visual captures pass;
- no whitespace errors.

- [ ] **Step 6: Complete the requirement-by-requirement audit**

Write `completion-audit.md` with one evidence row for each of the ten acceptance criteria in the approved design spec. Each row must identify the authoritative file, command output, test, screenshot, or browser state proving it. Mark missing or indirect evidence as incomplete and continue working; do not infer completion from a green narrow test.

- [ ] **Step 7: Request code review and resolve findings**

Invoke `superpowers:requesting-code-review`. Address every actionable finding, rerun the affected targeted test and then the full verification matrix.

- [ ] **Step 8: Commit final verification artifacts**

```powershell
git add README.md THIRD_PARTY_LICENSES.md docs/verification e2e/visual-fidelity.spec.ts
git diff --cached --check
git commit -m "docs: verify CRB 15000 simulator end to end"
```

---

## Spec Coverage Map

| Approved requirement | Implementing tasks | Authoritative proof |
|---|---|---|
| Seven supplied STEP robot links | 3, 5 | Asset report, seven GLBs, CAD validation, browser screenshot |
| Six browser-controlled joints | 3, 4, 5, 6 | Manifest tests, rig tests, E2E joint workflow |
| OPC UA-ready angle boundary | 4 | `JointAngleSource` contract and bad/stale frame tests |
| Future equipment STEP import | 8 | Real Worker import, LINK00 browser fixture, persistence E2E |
| Cups and equipment interaction | 7, 9 | Built-in assets, grasp reducer tests, pick/place E2E |
| Collision highlight/log/pause | 9, 11 | Interaction tests and core E2E |
| Red/yellow/green industrial asset | 7, 10, 11 | Status mapping tests, stack-light render, state E2E |
| Browser persistence | 7, 8, 11 | Dexie tests and reload/delete E2E |
| Industrial responsive UI | 1, 2, 10, 12 | Accepted concepts, DOM tests, responsive E2E, fidelity ledger |
| No PLC mutation | Global constraint, 12 | Source scan, README safety boundary, no AS6 diff |

## Plan Self-Review Checklist

- Every one of the ten acceptance criteria maps to implementation and direct evidence above.
- Joint origins, axes, limits, mesh world origins, import thresholds, stale timeout, tessellation values, gripper sensor size, snap tolerance, breakpoints, and viewport sizes are numeric and fixed.
- Type names remain consistent across tasks: `JointFrame`, `JointAngleSource`, `JointAnglesDeg`, `EquipmentRecord`, `EquipmentStatus`, `OcctResult`, and `CRB15000_DEFINITION`.
- No task requires a backend, live PLC, direct OPC UA connection, IK, rigid-body dynamics, or fluid simulation.
- The implementation order keeps every task independently reviewable and testable.
