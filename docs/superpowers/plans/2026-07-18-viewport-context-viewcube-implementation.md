# Viewport Context Gesture and 3D View Cube Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make right-button Pan and stationary Scene context clicks deterministic, replace the modal Scene menu with an anchored non-modal menu, and render a real World-referenced 3D View Cube with an accessible fallback.

**Architecture:** A pure gesture controller owns right-button distance and native-menu suppression state; SceneCanvasV4 owns document event routing and selection effects. Camera direction validation stays in camera-actions.ts, the Drei Cube renders inside the existing React Three Fiber Canvas, and the DOM overlay retains Home, Fit, Focus, and a keyboard-accessible orientation selector.

**Tech Stack:** React 19.2.7, TypeScript 6.0.3, React Three Fiber 9.6.1, Drei 10.7.7, Three.js 0.185.1, Zustand 5.0.14, Vitest 4.1.10, Testing Library, Playwright 1.61.1, Vite 8.1.4.

## Global Constraints

- Use Node >=22.15.1 <23 and npm >=11.4.2 <12.
- Preserve right-button drag as camera Pan and classify movement at exactly 5 CSS pixels as Pan.
- A stationary right click selects the exact pointer-down target and requests one Scene menu; a Pan changes neither selection nor menu state.
- Suppress native Context Menu only for matching right-button gestures begun inside the Scene Canvas; keep keyboard ContextMenu and Shift+F10 available.
- Keep World coordinates right-handed and Z-up; the View Cube never follows Robot, Tool, MCP, Work Object, or selection orientation.
- Reuse the existing React Three Fiber Canvas and installed Drei; add no dependency and no second WebGL context.
- GizmoViewcube.onClick must return null under the installed Drei 10.7.7 type contract.
- Keep Project, Robot, Job, OPC UA, Collision, and persistence behavior unchanged.
- Do not add a new destructive-action confirmation flow.
- Use the user's in-app browser for final visual acceptance. Ask before running Playwright CLI or MCP; the Playwright commands below remain gated until that execution-time approval.
- Before Task 1 changes the UI, use the user's in-app browser to load the same saved Project, export it locally, click Home View, select the same named Robot Link and Job, and set the browser viewport to 1440 by 900. Capture artifacts/ui/viewport-context-viewcube/before-light.png and before-dark.png. Write state.json with projectName and projectRevisionId read from the exported JSON, selectionLabel, activeRobotLabel, activeJobLabel, cameraPreset="home", viewportCssPx=[1440,900], and theme. Write matching after-light.png and after-dark.png in Task 6 after repeating those UI actions. Do not stage generated evidence unless the user asks.

---

### Task 1: Pure right-button gesture controller

**Files:**
- Create: src/features/scene/v4/right-button-gesture.ts
- Create: src/features/scene/v4/right-button-gesture.test.ts

**Interfaces:**
- Consumes: SceneSelectionTargetV4 and SceneContextRequestV4.
- Produces: createRightButtonGestureControllerV4(), RightButtonGestureControllerV4, and SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4.

- [ ] **Step 1: Write failing threshold and lifecycle tests**

~~~ts
import { describe, expect, it } from 'vitest'
import {
  createRightButtonGestureControllerV4,
  SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4,
} from './right-button-gesture.js'

describe('right-button Scene gesture V4', () => {
  it('treats below five pixels as context and exactly five as Pan', () => {
    const click = createRightButtonGestureControllerV4()
    click.begin({ button: 2, pointerId: 7, pointerType: 'mouse', clientX: 10, clientY: 20 })
    click.move({ pointerId: 7, clientX: 13, clientY: 23 })
    expect(click.finish({ pointerId: 7, clientX: 13, clientY: 23 })?.request).toEqual({
      selection: null,
      position: { x: 13, y: 23 },
    })

    const pan = createRightButtonGestureControllerV4()
    pan.begin({ button: 2, pointerId: 8, pointerType: 'pen', clientX: 0, clientY: 0 })
    pan.move({ pointerId: 8, clientX: 3, clientY: 4 })
    expect(pan.finish({ pointerId: 8, clientX: 3, clientY: 4 })?.request).toBeNull()
    expect(SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4).toBe(5)
  })

  it('retains the exact candidate and consumes only its matching native event', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 9, pointerType: 'mouse', clientX: 4, clientY: 6 })
    controller.setCandidate(9, { kind: 'robot-link', robotId: 'robot-1', linkId: 'L2' })
    const finished = controller.finish({ pointerId: 9, clientX: 4, clientY: 6 })
    expect(finished?.request).toEqual({
      selection: { kind: 'robot-link', robotId: 'robot-1', linkId: 'L2' },
      position: { x: 4, y: 6 },
    })
    expect(controller.consumeNativeContextMenu({
      button: 2, pointerId: 9, pointerType: 'mouse', clientX: 4, clientY: 6,
    })).toBe(true)
    expect(controller.consumeNativeContextMenu({
      button: 2, pointerId: 10, pointerType: 'mouse', clientX: 4, clientY: 6,
    })).toBe(false)
  })

  it('abandons active and completion state on cancel', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 3, pointerType: 'mouse', clientX: 1, clientY: 2 })
    controller.cancel(3)
    expect(controller.finish({ pointerId: 3, clientX: 1, clientY: 2 })).toBeNull()
  })

  it('matches legacy native events only by final coordinates and preserves keyboard menus', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 11, pointerType: 'mouse', clientX: 7, clientY: 8 })
    controller.finish({ pointerId: 11, clientX: 9, clientY: 10 })
    expect(controller.consumeNativeContextMenu({
      button: 2, clientX: 9, clientY: 10,
    })).toBe(true)

    controller.begin({ button: 2, pointerId: 12, pointerType: 'mouse', clientX: 0, clientY: 0 })
    controller.finish({ pointerId: 12, clientX: 0, clientY: 0 })
    expect(controller.consumeNativeContextMenu({
      button: 0, clientX: 0, clientY: 0,
    })).toBe(false)
  })

  it('does not let unrelated input or an older frame clear a newer completion', () => {
    const controller = createRightButtonGestureControllerV4()
    controller.begin({ button: 2, pointerId: 13, pointerType: 'mouse', clientX: 1, clientY: 1 })
    const first = controller.finish({ pointerId: 13, clientX: 1, clientY: 1 })
    controller.begin({ button: 0, pointerId: 14, pointerType: 'mouse', clientX: 2, clientY: 2 })
    controller.cancel(99)
    controller.begin({ button: 2, pointerId: 13, pointerType: 'mouse', clientX: 3, clientY: 3 })
    const second = controller.finish({ pointerId: 13, clientX: 3, clientY: 3 })
    controller.clearCompletion(first!.completionId)
    expect(controller.consumeNativeContextMenu({
      button: 2, pointerId: 13, pointerType: 'mouse', clientX: 3, clientY: 3,
    })).toBe(true)
    expect(second!.completionId).not.toBe(first!.completionId)
  })
})
~~~

- [ ] **Step 2: Run the test and confirm the missing-module failure**

~~~powershell
npm run test:run -- src/features/scene/v4/right-button-gesture.test.ts
~~~

Expected: FAIL because right-button-gesture.ts does not exist.

- [ ] **Step 3: Implement the controller**

~~~ts
import type { SceneSelectionTargetV4 } from '../../interaction/v4/scene-selection.js'
import type { SceneContextRequestV4 } from './scene-context-request.js'

export const SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4 = 5
const THRESHOLD_SQUARED_V4 = SCENE_CONTEXT_DRAG_THRESHOLD_PX_V4 ** 2

interface PointV4 {
  readonly pointerId: number
  readonly clientX: number
  readonly clientY: number
}

interface BeginV4 extends PointV4 {
  readonly button: number
  readonly pointerType: string
}

interface NativeContextV4 {
  readonly button: number
  readonly clientX: number
  readonly clientY: number
  readonly pointerId?: number
  readonly pointerType?: string
}

interface ActiveV4 extends PointV4 {
  readonly pointerType: 'mouse' | 'pen'
  readonly originClientX: number
  readonly originClientY: number
  readonly candidate: SceneSelectionTargetV4 | null
  readonly dragged: boolean
}

interface CompletionV4 extends PointV4 {
  readonly completionId: number
  readonly pointerType: 'mouse' | 'pen'
}

export interface FinishedRightButtonGestureV4 {
  readonly completionId: number
  readonly request: SceneContextRequestV4 | null
}

export interface RightButtonGestureControllerV4 {
  begin(event: BeginV4): boolean
  setCandidate(pointerId: number, selection: SceneSelectionTargetV4): void
  move(event: PointV4): void
  finish(event: PointV4): FinishedRightButtonGestureV4 | null
  cancel(pointerId?: number): void
  consumeNativeContextMenu(event: NativeContextV4): boolean
  clearCompletion(completionId: number): void
}

function advanceV4(active: ActiveV4, event: PointV4): ActiveV4 {
  const dx = event.clientX - active.originClientX
  const dy = event.clientY - active.originClientY
  return {
    ...active,
    clientX: event.clientX,
    clientY: event.clientY,
    dragged: active.dragged || dx * dx + dy * dy >= THRESHOLD_SQUARED_V4,
  }
}

export function createRightButtonGestureControllerV4(): RightButtonGestureControllerV4 {
  let active: ActiveV4 | null = null
  let completion: CompletionV4 | null = null
  let nextCompletionId = 0
  return {
    begin(event) {
      if (event.button !== 2 || (event.pointerType !== 'mouse' && event.pointerType !== 'pen')) {
        return false
      }
      completion = null
      active = {
        pointerId: event.pointerId,
        pointerType: event.pointerType,
        originClientX: event.clientX,
        originClientY: event.clientY,
        clientX: event.clientX,
        clientY: event.clientY,
        candidate: null,
        dragged: false,
      }
      return true
    },
    setCandidate(pointerId, selection) {
      if (active?.pointerId === pointerId) active = { ...active, candidate: selection }
    },
    move(event) {
      if (active?.pointerId === event.pointerId) active = advanceV4(active, event)
    },
    finish(event) {
      if (active?.pointerId !== event.pointerId) return null
      const finished = advanceV4(active, event)
      active = null
      const completionId = ++nextCompletionId
      completion = {
        completionId,
        pointerId: finished.pointerId,
        pointerType: finished.pointerType,
        clientX: finished.clientX,
        clientY: finished.clientY,
      }
      return {
        completionId,
        request: finished.dragged ? null : {
          selection: finished.candidate,
          position: { x: finished.clientX, y: finished.clientY },
        },
      }
    },
    cancel(pointerId) {
      if (pointerId === undefined) {
        active = null
        completion = null
        return
      }
      if (active?.pointerId === pointerId) active = null
      if (completion?.pointerId === pointerId) completion = null
    },
    consumeNativeContextMenu(event) {
      const record = active ?? completion
      if (record === null || event.button !== 2) return false
      const pointerMatches = typeof event.pointerId === 'number'
        ? record.pointerId === event.pointerId &&
          (event.pointerType === 'mouse' || event.pointerType === 'pen')
        : record.clientX === event.clientX && record.clientY === event.clientY
      if (!pointerMatches) return false
      if (record === completion) completion = null
      return true
    },
    clearCompletion(completionId) {
      if (completion?.completionId === completionId) completion = null
    },
  }
}
~~~

- [ ] **Step 4: Run the focused test**

~~~powershell
npm run test:run -- src/features/scene/v4/right-button-gesture.test.ts
~~~

Expected: 1 file and 5 tests PASS.

- [ ] **Step 5: Commit**

~~~powershell
git add src/features/scene/v4/right-button-gesture.ts src/features/scene/v4/right-button-gesture.test.ts
git commit -m "feat(viewport): classify right-button scene gestures"
~~~

### Task 2: Route Scene pointer ownership through the controller

**Files:**
- Modify: src/features/scene/v4/scene-context-request.ts
- Modify: src/features/scene/v4/SceneCanvas.tsx
- Modify: src/features/scene/v4/SceneCanvas.test.tsx
- Modify: src/features/robot/v4/RobotInstanceModel.tsx
- Modify: src/features/robot/v4/RobotInstanceModel.test.tsx
- Modify: src/features/scene/v4/SpatialEntityScene.tsx
- Modify: src/features/scene/v4/SpatialEntityScene.test.tsx

**Interfaces:**
- Consumes: RightButtonGestureControllerV4 from Task 1.
- Produces: WorkcellInteractionHandlersV4.onContextCandidate(selection, pointerId).

- [ ] **Step 1: Write failing interaction tests**

In RobotInstanceModel.test.tsx and SpatialEntityScene.test.tsx, replace native context assertions with:

~~~ts
const onContextCandidate = vi.fn()
const interaction = { onSelect, onContextCandidate }

fireEvent.pointerDown(primitive, { button: 2, pointerId: 21 })
expect(onContextCandidate).toHaveBeenCalledWith(
  { kind: 'robot', robotId: robot.id },
  21,
)
expect(onSelect).not.toHaveBeenCalled()

fireEvent.pointerDown(primitive, { button: 0, pointerId: 22 })
expect(onSelect).toHaveBeenCalledWith({ kind: 'robot', robotId: robot.id })
~~~

In SceneCanvas.test.tsx, cover a stationary exact target, empty stationary click, a 5-pixel Pan, pointer cancel, window blur, hidden document, release outside the Canvas, primary pointer miss, and an unmatched keyboard ContextMenu.
Also dispatch a legacy MouseEvent contextmenu without pointerId at matching and non-matching final coordinates, and complete two right-click gestures in one animation frame to prove the first cleanup cannot clear the second completion.

- [ ] **Step 2: Run the affected tests**

~~~powershell
npm run test:run -- src/features/scene/v4/SceneCanvas.test.tsx src/features/robot/v4/RobotInstanceModel.test.tsx src/features/scene/v4/SpatialEntityScene.test.tsx
~~~

Expected: FAIL because onContextCandidate and document gesture routing are absent.

- [ ] **Step 3: Replace the workcell interaction contract**

~~~ts
export interface WorkcellInteractionHandlersV4 {
  readonly onSelect: (selection: SceneSelectionTargetV4) => void
  readonly onContextCandidate: (
    selection: SceneSelectionTargetV4,
    pointerId: number,
  ) => void
}
~~~

- [ ] **Step 4: Branch Robot and Spatial pointer handlers by button**

For Robot:

~~~ts
onPointerDown: (event: ThreeEvent<PointerEvent>) => {
  const selection = selectionForHit(hitFromEvent(event))
  if (event.button === 0) {
    event.stopPropagation()
    interaction.onSelect(selection)
  } else if (event.button === 2) {
    event.stopPropagation()
    interaction.onContextCandidate(selection, event.pointerId)
  }
},
~~~

Use the same branch with the existing Spatial Entity selection. stopPropagation here stops lower R3F intersections from overwriting the qualified topmost candidate; do not call preventDefault or stop the native DOM event used by OrbitControls. Remove both native onContextMenu handlers.

- [ ] **Step 5: Make SceneCanvasV4 own document capture**

Create one controller with useRef(createRightButtonGestureControllerV4()). The outer Scene surface calls begin from onPointerDownCapture. Register document capture listeners for pointermove, pointerup, pointercancel, and contextmenu; register window blur and document visibilitychange. Every effect cleanup removes the exact same listener and cancels the controller. visibilitychange cancels only when document.visibilityState is hidden.

~~~ts
const onScenePointerDownCapture = useCallback((event: React.PointerEvent) => {
  gestureRef.current.begin({
    button: event.button,
    pointerId: event.pointerId,
    pointerType: event.pointerType,
    clientX: event.clientX,
    clientY: event.clientY,
  })
}, [])

const finishGesture = useCallback((event: PointerEvent): void => {
  const gesture = gestureRef.current
  const finished = gesture.finish(event)
  if (finished === null) return
  if (finished.request !== null) {
    if (finished.request.selection === null) interaction.getState().clearSelection()
    else interaction.getState().select(finished.request.selection)
    onContextRequest(finished.request)
  }
  const completionId = finished.completionId
  requestAnimationFrame(() => gesture.clearCompletion(completionId))
}, [interaction, onContextRequest])
~~~

The document contextmenu handler converts PointerEvent or legacy MouseEvent fields into NativeContextV4. For PointerEvent, pass pointerId and pointerType and require mouse or pen. For a legacy event, omit both fields so only button 2 at the recorded final coordinates can match. Call preventDefault and stopPropagation only when consumeNativeContextMenu returns true; a keyboard ContextMenu or Shift+F10 therefore passes through.

pointercancel calls cancel(event.pointerId). blur, hidden-document, and unmount call cancel() without an ID. An unrelated pointer ID changes no active or completion state. The completionId guard makes an older animation-frame callback harmless after a new completion.

Use one effect with stable local callbacks and capture=true for every document listener:

~~~ts
useEffect(() => {
  const gesture = gestureRef.current
  const onMove = (event: PointerEvent) => gesture.move(event)
  const onUp = (event: PointerEvent) => finishGesture(event)
  const onCancel = (event: PointerEvent) => gesture.cancel(event.pointerId)
  const onNativeMenu = (event: MouseEvent) => {
    const pointer = event as MouseEvent & Partial<PointerEvent>
    const matched = gesture.consumeNativeContextMenu({
      button: event.button,
      clientX: event.clientX,
      clientY: event.clientY,
      ...(typeof pointer.pointerId === 'number'
        ? { pointerId: pointer.pointerId, pointerType: pointer.pointerType }
        : {}),
    })
    if (matched) {
      event.preventDefault()
      event.stopPropagation()
    }
  }
  const onBlur = () => gesture.cancel()
  const onVisibility = () => {
    if (document.visibilityState === 'hidden') gesture.cancel()
  }
  document.addEventListener('pointermove', onMove, true)
  document.addEventListener('pointerup', onUp, true)
  document.addEventListener('pointercancel', onCancel, true)
  document.addEventListener('contextmenu', onNativeMenu, true)
  window.addEventListener('blur', onBlur)
  document.addEventListener('visibilitychange', onVisibility)
  return () => {
    document.removeEventListener('pointermove', onMove, true)
    document.removeEventListener('pointerup', onUp, true)
    document.removeEventListener('pointercancel', onCancel, true)
    document.removeEventListener('contextmenu', onNativeMenu, true)
    window.removeEventListener('blur', onBlur)
    document.removeEventListener('visibilitychange', onVisibility)
    gesture.cancel()
  }
}, [finishGesture])
~~~

Add onPointerDownCapture={onScenePointerDownCapture} to the existing scene-canvas-surface-v4 div without adding a wrapper or a second Canvas. Replace the current interaction prop with:

~~~ts
interaction={{
  onSelect: handleSelect,
  onContextCandidate: (selection, pointerId) => {
    gestureRef.current.setCandidate(pointerId, selection)
  },
}}
~~~

Delete entityContextHandled, handleEntityContext, and the surface native onContextMenu. Clear selection from Canvas onPointerMissed only when event.button is 0.

- [ ] **Step 6: Run all gesture and renderer tests**

~~~powershell
npm run test:run -- src/features/scene/v4/right-button-gesture.test.ts src/features/scene/v4/SceneCanvas.test.tsx src/features/robot/v4/RobotInstanceModel.test.tsx src/features/scene/v4/SpatialEntityScene.test.tsx src/features/robot/v4/RobotFleet.test.tsx
~~~

Expected: all listed files PASS; right Pan changes neither selection nor context request.

- [ ] **Step 7: Commit**

~~~powershell
git add src/features/scene/v4/scene-context-request.ts src/features/scene/v4/SceneCanvas.tsx src/features/scene/v4/SceneCanvas.test.tsx src/features/robot/v4/RobotInstanceModel.tsx src/features/robot/v4/RobotInstanceModel.test.tsx src/features/scene/v4/SpatialEntityScene.tsx src/features/scene/v4/SpatialEntityScene.test.tsx
git commit -m "fix(viewport): separate pan from context clicks"
~~~

### Task 3: Make Scene Context Menu anchored and non-modal

**Files:**
- Modify: src/features/scene/v4/SceneContextMenu.tsx
- Modify: src/features/scene/v4/SceneContextMenu.test.tsx
- Modify: src/styles/global.css

**Interfaces:**
- Consumes: unchanged SceneContextRequestV4 and current Scene action resolver.
- Produces: one portal-rendered role=menu without dialog backdrop or root inert state.

- [ ] **Step 1: Write failing modality and focus tests**

Assert all of the following:

~~~ts
expect(screen.getByRole('menu', { name: 'Scene actions' })).toBeVisible()
expect(screen.queryByRole('dialog')).not.toBeInTheDocument()
expect(document.getElementById('root')).not.toHaveAttribute('inert')
~~~

Test Escape, Tab, and successful command focus restoration separately. Test outside pointerdown closes without restoring focus. Rerender with a replacement request and assert the original focus owner remains the restoration target. Retain Arrow, Home, End, pending, disabled, stale-target, and inline-error coverage.

Use one named test per close reason rather than a shared ambiguous helper: Escape restores the focused trigger; Tab restores it; Shift+Tab restores it; outside pointerdown leaves focus on the outside control. Add separate async action tests: a resolved action closes and restores, a rejected action stays open with role=alert, and repeated invocation is blocked while pending. No test expects a new destructive confirmation layer.

- [ ] **Step 2: Run the focused test**

~~~powershell
npm run test:run -- src/features/scene/v4/SceneContextMenu.test.tsx
~~~

Expected: FAIL because the current component renders a modal dialog and sets root.inert.

- [ ] **Step 3: Render only the anchored menu portal**

~~~tsx
const menu = (
  <div
    aria-label="Scene actions"
    className="scene-context-menu scene-context-menu-v4"
    onKeyDown={onMenuKeyDown}
    ref={menuRef}
    role="menu"
    style={{ left: position.x, top: position.y }}
    tabIndex={-1}
  >
    {actions.map((action) => (
      <button
        disabled={pending || action.disabled === true}
        key={action.label}
        onClick={() => runAction(action)}
        role="menuitem"
        tabIndex={-1}
        type="button"
      >
        {action.label}
      </button>
    ))}
    {staleError === null && error === null ? null : (
      <p role="alert">{error ?? staleError}</p>
    )}
  </div>
)
return createPortal(menu, document.body)
~~~

Delete root inert mutation and the backdrop. Use a document capture pointerdown listener; close only if menuRef.current does not contain the event target. Track restoreFocusOnCloseRef: true for Escape, Tab, and successful commands; false for outside pointerdown.

Capture focus only on the closed-to-open transition. While request remains non-null, replacement updates commands and position but not focusOwnerRef. The close effect restores only when restoreFocusOnCloseRef is true and focusOwnerRef.current is still connected, then clears both refs. This avoids restoration/recapture between replacement requests.

- [ ] **Step 4: Change Tab from cycling to close-and-restore**

~~~ts
if (event.key === 'Tab') {
  event.preventDefault()
  event.stopPropagation()
  restoreFocusOnCloseRef.current = true
  onClose()
  return
}
~~~

Keep ArrowUp, ArrowDown, Home, and End roving through enabled items.

- [ ] **Step 5: Remove backdrop CSS and retain anchored-menu styling**

Keep scene-context-menu-v4 fixed-positioned with z-index 1200, panel background, one-pixel border, six-pixel radius, and the existing restrained shadow. Remove the full-screen Scene context backdrop rules.

- [ ] **Step 6: Run and commit**

~~~powershell
npm run test:run -- src/features/scene/v4/SceneContextMenu.test.tsx
git add src/features/scene/v4/SceneContextMenu.tsx src/features/scene/v4/SceneContextMenu.test.tsx src/styles/global.css
git commit -m "fix(scene): make context actions non-modal"
~~~

Expected: the menu test file PASS with no modal dialog or root inert state.

### Task 4: Add validated World-direction camera movement

**Files:**
- Modify: src/features/viewport/camera-actions.ts
- Modify: src/features/viewport/camera-actions.test.ts

**Interfaces:**
- Produces: WorldViewDirectionV4 and ViewportCameraActions.setWorldDirection(direction): boolean.

- [ ] **Step 1: Write failing validation tests**

~~~ts
it('rejects non-finite and zero directions without mutation', () => {
  const { camera, controls, actions } = harness()
  const position = camera.position.clone()
  expect(actions.setWorldDirection([0, 0, 0])).toBe(false)
  expect(actions.setWorldDirection([Number.NaN, 0, 1])).toBe(false)
  expect(actions.setWorldDirection([Number.POSITIVE_INFINITY, 0, 1])).toBe(false)
  expect(camera.position).toEqual(position)
  expect(controls.update).not.toHaveBeenCalled()
})

it('normalizes a diagonal and preserves target and distance', () => {
  const { camera, controls, actions } = harness()
  const target = controls.target.clone()
  const distance = camera.position.distanceTo(target)
  expect(actions.setWorldDirection([2, -2, 2])).toBe(true)
  expect(controls.target).toEqual(target)
  expect(camera.position.distanceTo(target)).toBeCloseTo(distance)
})
~~~

Also assert Top, Bottom, and near-pole use [0, 1, 0], other directions use [0, 0, 1], every preset equals its raw direction, and a pre-existing distance below 0.8 is raised to the OrbitControls minimum of 0.8.

- [ ] **Step 2: Run the camera test**

~~~powershell
npm run test:run -- src/features/viewport/camera-actions.test.ts
~~~

Expected: FAIL with missing setWorldDirection.

- [ ] **Step 3: Implement the validated primitive**

~~~ts
export type WorldViewDirectionV4 = readonly [number, number, number]

function finiteWorldDirectionV4(direction: WorldViewDirectionV4): Vector3 | null {
  if (!direction.every(Number.isFinite)) return null
  const normalized = new Vector3(...direction)
  if (normalized.lengthSq() < 1e-8) return null
  return normalized.normalize()
}

const setWorldDirection = (direction: WorldViewDirectionV4): boolean => {
  const normalized = finiteWorldDirectionV4(direction)
  if (normalized === null) return false
  const target = controls.target.clone()
  const currentDistance = camera.position.distanceTo(target)
  const distance = Math.max(
    Number.isFinite(currentDistance) ? currentDistance : 0,
    0.8,
  )
  camera.position.copy(target).addScaledVector(normalized, distance)
  const up: readonly [number, number, number] =
    Math.abs(normalized.z) >= 0.999 ? [0, 1, 0] : [0, 0, 1]
  applyView(camera, controls, up)
  return true
}
~~~

Add setWorldDirection to ViewportCameraActions. The closure preserves the current Orbit target and uses Math.max(current distance, 0.8), matching the existing OrbitControls minDistance guard. It uses [0, 1, 0] when abs(z) >= 0.999 and [0, 0, 1] otherwise, applies the view, and returns true. Invalid direction input returns false before camera mutation. setStandardView delegates to that closure.

- [ ] **Step 4: Run and commit**

~~~powershell
npm run test:run -- src/features/viewport/camera-actions.test.ts
git add src/features/viewport/camera-actions.ts src/features/viewport/camera-actions.test.ts
git commit -m "feat(viewport): support validated world directions"
~~~

Expected: all camera tests PASS.

### Task 5: Render the Drei Cube and accessible fallback

**Files:**
- Create: src/features/viewport/v4/viewport-safe-area.ts
- Create: src/features/viewport/v4/WorldViewCube.tsx
- Create: src/features/viewport/v4/WorldViewCube.test.tsx
- Create: src/features/viewport/v4/ViewOrientationControl.tsx
- Create: src/features/viewport/v4/ViewOrientationControl.test.tsx
- Modify: src/features/scene/v4/SceneCanvas.tsx
- Modify: src/features/scene/v4/SceneCanvas.test.tsx
- Modify: src/features/viewport/v4/viewport-runtime.tsx
- Modify: src/features/viewport/v4/viewport-runtime.test.tsx
- Modify: src/features/viewport/v4/ViewportOverlay.tsx
- Modify: src/features/viewport/v4/ViewportOverlay.test.tsx
- Modify: src/styles/global.css
- Delete: src/features/viewport/ViewCube.tsx
- Delete: src/features/viewport/ViewCube.test.tsx

**Interfaces:**
- Consumes: WorldViewDirectionV4 and setWorldDirection from Task 4.
- Produces: ViewportSafeAreaInsetsV4, WorldViewCubeV4({ onDirection, safeAreaInsets }), and ViewOrientationControlV4({ onSelect }).

- [ ] **Step 1: Write failing Cube and fallback tests**

Mock GizmoHelper and GizmoViewcube, capture their props, and assert:

~~~ts
expect(cubeProps.faces).toEqual([
  'Right', 'Left', 'Back', 'Front', 'Top', 'Bottom',
])
const result = cubeProps.onClick({
  face: { normal: new Vector3(0, 0, 1) },
  object: { position: new Vector3(0, 0, 0) },
  stopPropagation,
})
expect(result).toBeNull()
expect(onDirection).toHaveBeenCalledWith([0, 0, 1])
~~~

Drive the callback once for each of the six normals and assert the World directions +X, -X, +Y, -Y, +Z, and -Z in the approved label order. Use a non-zero object.position to assert edge or corner direction wins. Assert the group scale is 88 / 60, GizmoViewcube receives the neutral palette and hoverColor #38bdf8, and safeAreaInsets increase the top/right Gizmo margin without changing its World reference. In the fallback test, select each StandardWorldView and assert one callback while the select returns to its blank prompt option.

In viewport-runtime.test.tsx, mock OrbitControls, GizmoHelper, and GizmoViewcube and assert both controls and the Cube render in the same runtime fragment. Model the real OrbitControls behavior by having controls.update() synchronously dispatch one change event into handleControlsChange. Invoke a valid Cube direction and assert cameraState is persisted exactly once through that change event; make setWorldDirection return false without controls.update() for an invalid direction and assert no preference write. In ViewportOverlay.test.tsx, select a fallback orientation and assert it calls the same setStandardView action once with no direct Project mutation. In browser acceptance, assert the Scene contains exactly one canvas before and after Cube interaction.

- [ ] **Step 2: Run the new tests**

~~~powershell
npm run test:run -- src/features/viewport/v4/WorldViewCube.test.tsx src/features/viewport/v4/ViewOrientationControl.test.tsx src/features/viewport/v4/viewport-runtime.test.tsx src/features/viewport/v4/ViewportOverlay.test.tsx src/features/scene/v4/SceneCanvas.test.tsx
~~~

Expected: FAIL because both components and the safe-area runtime path are absent.

- [ ] **Step 3: Implement WorldViewCubeV4**

Create viewport-safe-area.ts as the shared Shell-to-Viewport contract:

~~~ts
export interface ViewportSafeAreaInsetsV4 {
  readonly top: number
  readonly right: number
  readonly bottom: number
  readonly left: number
}

export const ZERO_VIEWPORT_SAFE_AREA_INSETS_V4: ViewportSafeAreaInsetsV4 =
  Object.freeze({ top: 0, right: 0, bottom: 0, left: 0 })
~~~

~~~tsx
import { GizmoHelper } from '@react-three/drei/core/GizmoHelper.js'
import { GizmoViewcube } from '@react-three/drei/core/GizmoViewcube.js'
import type { ThreeEvent } from '@react-three/fiber'
import type { ReactNode } from 'react'
import { Vector3 } from 'three'
import type { WorldViewDirectionV4 } from '../camera-actions.js'
import {
  ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
  type ViewportSafeAreaInsetsV4,
} from './viewport-safe-area.js'

export interface WorldViewCubePropsV4 {
  readonly onDirection: (direction: WorldViewDirectionV4) => void
  readonly safeAreaInsets?: ViewportSafeAreaInsetsV4
}

const VIEW_CUBE_TARGET_PX_V4 = 88
const DREI_VIEW_CUBE_BASE_PX_V4 = 60

export function WorldViewCubeV4({
  onDirection,
  safeAreaInsets = ZERO_VIEWPORT_SAFE_AREA_INSETS_V4,
}: WorldViewCubePropsV4): ReactNode {
  const handleClick = (event: ThreeEvent<MouseEvent>): null => {
    event.stopPropagation()
    const objectDirection = event.object.position
    const source = objectDirection.lengthSq() > 1e-8
      ? objectDirection
      : event.face?.normal ?? new Vector3()
    onDirection([source.x, source.y, source.z])
    return null
  }
  return (
    <GizmoHelper
      alignment="top-right"
      margin={[56 + safeAreaInsets.right, 56 + safeAreaInsets.top]}
    >
      <group scale={VIEW_CUBE_TARGET_PX_V4 / DREI_VIEW_CUBE_BASE_PX_V4}>
        <GizmoViewcube
          color="#d9e2e8"
          faces={['Right', 'Left', 'Back', 'Front', 'Top', 'Bottom']}
          hoverColor="#38bdf8"
          onClick={handleClick}
          strokeColor="#526674"
          textColor="#17232d"
        />
      </group>
    </GizmoHelper>
  )
}
~~~

- [ ] **Step 4: Implement the fallback selector**

Create a select with aria-label View orientation and value "". Options are blank View orientation, Isometric, Top, Front, Right, Back, Left, and Bottom. Ignore blank changes; call onSelect with StandardWorldView. Keeping value "" prevents false active state after free Orbit:

~~~tsx
const VIEW_ORIENTATION_OPTIONS_V4 = Object.freeze([
  ['isometric', 'Isometric'],
  ['top', 'Top'],
  ['front', 'Front'],
  ['right', 'Right'],
  ['back', 'Back'],
  ['left', 'Left'],
  ['bottom', 'Bottom'],
] as const satisfies readonly (readonly [StandardWorldView, string])[])

<select
  aria-label="View orientation"
  onChange={(event) => {
    if (event.currentTarget.value !== '') {
      onSelect(event.currentTarget.value as StandardWorldView)
    }
  }}
  value=""
>
  <option value="">View orientation</option>
  {VIEW_ORIENTATION_OPTIONS_V4.map(([view, label]) => (
    <option key={view} value={view}>{label}</option>
  ))}
</select>
~~~

- [ ] **Step 5: Mount the Cube inside ViewportRuntimeV4**

Return a fragment containing the existing OrbitControls and WorldViewCubeV4, never another Canvas. The Cube callback only calls cameraActions.setWorldDirection. A successful setWorldDirection reaches applyView, calls controls.update(), and the existing OrbitControls onChange path persists captureViewportCameraState exactly once; the callback must not write preferences itself. Extract the current Orbit onChange body into handleControlsChange instead of duplicating it. Thread safeAreaInsets from SceneCanvasV4 through ViewportRuntimeV4 with a zero default; the Docked Workspace plan later supplies non-zero overlay insets.

~~~tsx
const handleControlsChange = useCallback((): void => {
  if (!(camera instanceof PerspectiveCamera) || controls === null) return
  preferences.getState().setCameraState(
    captureViewportCameraState(camera, controls) as ViewportCameraStateV4,
  )
}, [camera, controls, preferences])

const handleCubeDirection = useCallback((direction: WorldViewDirectionV4): void => {
  cameraActions?.setWorldDirection(direction)
}, [cameraActions])

return (
  <>
    <OrbitControls
      enableDamping
      makeDefault
      minDistance={0.8}
      onChange={handleControlsChange}
      ref={registerControls}
      target={storedTarget}
    />
    <WorldViewCubeV4
      onDirection={handleCubeDirection}
      safeAreaInsets={safeAreaInsets}
    />
  </>
)
~~~

In ViewportOverlayV4, remove the old ViewCube import and render ViewOrientationControlV4 beside Home, Fit, and Focus. Delete the old DOM Cube files.

- [ ] **Step 6: Replace fake-Cube CSS**

Delete view-cube, view-cube button, view-cube-corner, and the max-width 900 fake-Cube hide rule. Keep overlay utilities at least 40 CSS pixels and use existing panel, border, radius, hover, focus-visible, Light, and Dark tokens.

- [ ] **Step 7: Run and commit**

~~~powershell
npm run test:run -- src/features/viewport/camera-actions.test.ts src/features/viewport/v4/WorldViewCube.test.tsx src/features/viewport/v4/ViewOrientationControl.test.tsx src/features/viewport/v4/viewport-runtime.test.tsx src/features/viewport/v4/ViewportOverlay.test.tsx src/features/scene/v4/SceneCanvas.test.tsx
git add src/features/viewport/v4/viewport-safe-area.ts src/features/viewport/v4/WorldViewCube.tsx src/features/viewport/v4/WorldViewCube.test.tsx src/features/viewport/v4/ViewOrientationControl.tsx src/features/viewport/v4/ViewOrientationControl.test.tsx src/features/viewport/v4/viewport-runtime.tsx src/features/viewport/v4/viewport-runtime.test.tsx src/features/viewport/v4/ViewportOverlay.tsx src/features/viewport/v4/ViewportOverlay.test.tsx src/features/scene/v4/SceneCanvas.tsx src/features/scene/v4/SceneCanvas.test.tsx src/features/viewport/ViewCube.tsx src/features/viewport/ViewCube.test.tsx src/styles/global.css
git commit -m "feat(viewport): add world-referenced 3d view cube"
~~~

Expected: all listed tests PASS and the old DOM World view cube grid is absent.

### Task 6: Add browser acceptance and repository gates

**Files:**
- Create: tests/viewport-context-viewcube.spec.ts
- Modify: playwright.config.ts
- Modify: package.json
- Modify: src/test/playwright-build-contract.test.ts

**Interfaces:**
- Produces: npm run test:e2e:viewport and inclusion in the test:e2e gate.

- [ ] **Step 1: Write a failing Playwright build-contract test**

Assert package.json contains:

~~~json
{
  "scripts": {
    "test:e2e:viewport": "playwright test tests/viewport-context-viewcube.spec.ts",
    "test:e2e": "npm run test:e2e:v4 && npm run test:e2e:viewport",
    "verify": "npm run lint && npm run test:run && npm run cad:validate && npm run deploy:validate && npm run build:gateway && node dist-gateway/middleware/runtime-gateway/main.js --check-config && npm run build && npm run test:e2e"
  }
}
~~~

Assert playwright.config.ts no longer restricts discovery to project-v4-multi-robot.spec.ts, and assert verify delegates to test:e2e rather than calling test:e2e:v4 directly.

- [ ] **Step 2: Run the contract test**

~~~powershell
npm run test:run -- src/test/playwright-build-contract.test.ts
~~~

Expected: FAIL because the viewport E2E script and discovery are absent.

- [ ] **Step 3: Add the browser acceptance flow and scripts**

The E2E performs a stationary empty right click, asserts one role=menu and no dialog, closes with Escape, performs a right drag of at least 5 CSS pixels and asserts no menu, then selects Top and Front through the stable DOM View orientation fallback and confirms the Viewport remains ready. Use a prior Scene tree selection to prove Pan preserves selection. Assert `.scene-canvas canvas` count is exactly one before and after orientation interaction. All six WebGL faces plus one edge/corner remain deterministic component tests; actual Cube face/corner clicking is a manual in-app-browser acceptance item because the rendered Gizmo has no stable DOM coordinate contract.

- [ ] **Step 4: Run automated gates**

~~~powershell
npm run test:e2e:viewport
npm run lint
npm run test:run
npm run build
npm run verify
~~~

Expected: viewport E2E, lint, Vitest, and production build PASS; only the existing large-bundle warning may remain.

- [ ] **Step 5: Verify visually in the user's in-app browser**

At the same Project and desktop viewport in Light and Dark themes:

1. Right-drag more than 5 CSS pixels over a Robot Link: Pan occurs, selection remains, no menu appears.
2. Stationary-right-click the Link: one anchored menu opens without dimming.
3. Outside click, Escape, and Tab each follow the approved focus behavior.
4. Top, Front, and one Cube corner preserve World Z-up, Orbit target, and distance.
5. The keyboard orientation selector and Home, Fit, and Focus remain usable.

Capture the after screenshot only after reloading the Project named in state.json, clicking Home View, and restoring the recorded Link, Job, viewport size, and Theme. Export once more and confirm its projectRevisionId matches state.json. For each theme, load the before and after PNGs in one tool call that emits both images to the same visual comparison input; check the 88-by-88 Cube footprint, overlay spacing, removed dimming, contrast, focus indication, and clipping. If any recorded field differs, restore it and recapture instead of judging mismatched images.

- [ ] **Step 6: Commit**

~~~powershell
git add tests/viewport-context-viewcube.spec.ts playwright.config.ts package.json src/test/playwright-build-contract.test.ts
git commit -m "test(viewport): cover context gestures and view cube"
~~~

## Final Verification

~~~powershell
npm run test:run -- src/features/scene/v4/right-button-gesture.test.ts src/features/scene/v4/SceneCanvas.test.tsx src/features/robot/v4/RobotInstanceModel.test.tsx src/features/scene/v4/SpatialEntityScene.test.tsx src/features/scene/v4/SceneContextMenu.test.tsx src/features/viewport/camera-actions.test.ts src/features/viewport/v4/WorldViewCube.test.tsx src/features/viewport/v4/ViewOrientationControl.test.tsx src/features/viewport/v4/viewport-runtime.test.tsx src/features/viewport/v4/ViewportOverlay.test.tsx src/test/playwright-build-contract.test.ts
npm run lint
npm run build
npm run test:e2e:viewport
npm run test:e2e:v4
npm run verify
~~~

Expected: every command exits with code 0; verify includes the new viewport browser gate, and paired visual evidence confirms deterministic Pan/context behavior, one Canvas, the 88-pixel non-clipped Cube, correct World Z-up directions, and accessible orientation fallback.
