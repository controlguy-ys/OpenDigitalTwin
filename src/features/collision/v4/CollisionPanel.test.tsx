import { act, render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { StrictMode } from 'react'
import { describe, expect, it, vi } from 'vitest'
import {
  canonicalCollisionPairKeyV4,
  robotLinkCollisionIdV4,
  spatialEntityCollisionIdV4,
} from '../../../core/robot-runtime/collision-identity.js'
import {
  validateGeometryCollisionEntityV4,
  type CollisionPolicyV4,
} from '../../../domain/collision/collision.js'
import type { CollisionGeometryProxyV4 } from './scene-entity-adapter-v4.js'
import { createAppCommandBindingsV4, createAppCommandRuntimeV4 } from '../../commands/v4/app-command-runtime.js'
import { createAppCommandRegistryV4 } from '../../commands/v4/app-command-registry.js'
import {
  createCollisionValidationControllerV4,
  queryVisibleGeometryCollisionsV4,
  type CollisionQueryV4,
  type CollisionValidationStateV4,
} from './collision-validation-controller.js'
import { CollisionPanelV4 } from './CollisionPanel.js'
import { AppMenuBarV4 } from '../../ui/v4/AppMenuBarV4.js'
import type { AppMenuSectionModelV4 } from '../../ui/v4/app-menu-model.js'

const IDENTITY_MATRIX = Object.freeze([
  1, 0, 0, 0,
  0, 1, 0, 0,
  0, 0, 1, 0,
  0, 0, 0, 1,
])

function proxy(
  id: ReturnType<typeof robotLinkCollisionIdV4> | ReturnType<typeof spatialEntityCollisionIdV4>,
  category: 'robot-link' | 'spatial-entity',
  x = 0,
): CollisionGeometryProxyV4 {
  const worldMatrix = [...IDENTITY_MATRIX]
  worldMatrix[12] = x
  return Object.freeze({
    effectiveVisible: true,
    entity: validateGeometryCollisionEntityV4({
      id,
      name: id,
      category,
      worldMatrix,
      boxes: [{
        id: 'body',
        center: [0, 0, 0],
        halfExtents: [1, 1, 1],
        quaternion: [0, 0, 0, 1],
      }],
    }),
  })
}

function policy(overrides: Partial<CollisionPolicyV4> = {}): CollisionPolicyV4 {
  return {
    enabled: true,
    nearMissMarginM: 0.1,
    excludedPairKeys: new Set(),
    intentionalMountPairKeys: new Set(),
    ignoredContactPairKeys: new Set(),
    ...overrides,
  }
}

function queryResult() {
  return {
    findings: [],
    telemetry: {
      entityCount: 1,
      boxCount: 1,
      broadPhaseCandidateCount: 0,
      narrowPhaseTestCount: 0,
      findingCount: 0,
    },
  }
}

function createPanelHarnessV4(input: {
  readonly projectRevisionId: string
  readonly policy: CollisionPolicyV4
  readonly proxies: readonly CollisionGeometryProxyV4[]
  readonly jobRunning?: boolean
  readonly query?: CollisionQueryV4
}) {
  const controller = createCollisionValidationControllerV4({
    initialInput: {
      projectRevisionId: input.projectRevisionId,
      policy: input.policy,
      proxies: input.proxies,
      jobRunning: input.jobRunning ?? false,
      query: input.query ?? queryVisibleGeometryCollisionsV4,
    },
  })
  const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([{
    id: 'collision.validate',
    label: 'Validate Collision',
    section: 'simulation',
    kind: 'action',
    visible: true,
    get enabled() { return controller.getState().canValidate },
    execute: () => controller.validate(),
  }]))
  return { controller, commandBindings: createAppCommandBindingsV4(runtime), runtime }
}

const COLLISION_MENU_MODEL: readonly AppMenuSectionModelV4[] = Object.freeze([Object.freeze({
  id: 'simulation',
  label: 'Simulation',
  children: Object.freeze([{ kind: 'command' as const, commandId: 'collision.validate' }]),
})])

function CollisionCommandMenuV4({
  commandBindings,
}: {
  readonly commandBindings: ReturnType<typeof createAppCommandBindingsV4>
}) {
  return <AppMenuBarV4
    commandBindings={commandBindings}
    model={COLLISION_MENU_MODEL}
    openSection="simulation"
    onOpenSectionChange={() => undefined}
    onPreviewSection={() => undefined}
  />
}

function createControllerErrorBeforeRuntimeSettleV4() {
  let state: CollisionValidationStateV4 = Object.freeze({
    projectRevisionId: 'controller-error-before-runtime-settle',
    pending: false,
    canValidate: true,
    error: null,
    result: null,
  })
  const listeners = new Set<() => void>()
  let rejectValidation!: (error: Error) => void
  const pendingValidation = new Promise<void>((_resolve, reject) => {
    rejectValidation = reject
  })
  const publish = (): void => {
    for (const listener of new Set(listeners)) listener()
  }
  const controller = Object.freeze({
    getState: () => state,
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    replaceInput() {},
    validate() {
      state = Object.freeze({
        ...state,
        error: 'Controller reported failure before runtime settlement.',
      })
      publish()
      return pendingValidation
    },
    dispose() {
      listeners.clear()
    },
  })
  return { controller, rejectValidation: (error: Error) => rejectValidation(error) }
}

describe('CollisionPanelV4', () => {
  it('queries registered V4 proxies only on request and focuses an exact namespaced target', async () => {
    const user = userEvent.setup()
    const robot = proxy(robotLinkCollisionIdV4('robot-1', 'base'), 'robot-link')
    const fixture = proxy(spatialEntityCollisionIdV4('fixture'), 'spatial-entity')
    const onFocus = vi.fn()
    const query = vi.fn(async (
      candidatePolicy: CollisionPolicyV4,
      proxies: readonly CollisionGeometryProxyV4[],
    ) => {
      const { queryGeometryCollisionsWithTelemetryV4 } = await import(
        '../../../domain/collision/query-collision.js'
      )
      return queryGeometryCollisionsWithTelemetryV4(
        proxies.map(({ entity }) => entity),
        candidatePolicy,
      )
    })

    const harness = createPanelHarnessV4({
      projectRevisionId: 'revision-a', policy: policy(), proxies: [robot, fixture], query,
    })
    render(
      <CollisionPanelV4
        commandBindings={harness.commandBindings}
        controller={harness.controller}
        onFocus={onFocus}
      />,
    )

    expect(query).not.toHaveBeenCalled()
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))

    expect(query).toHaveBeenCalledOnce()
    expect(screen.getByText('Collisions 1')).toBeVisible()
    expect(screen.getByText('Near-misses 0')).toBeVisible()
    expect(screen.getByText(/robot-link:robot-1:base/)).toBeVisible()
    await user.click(screen.getByRole('button', {
      name: 'Focus robot-link:robot-1:base',
    }))
    expect(onFocus).toHaveBeenCalledWith({
      kind: 'robot-link',
      robotId: 'robot-1',
      linkId: 'base',
    })
  })

  it('reports near-misses and applies intentional mount exclusions', async () => {
    const user = userEvent.setup()
    const robot = proxy(robotLinkCollisionIdV4('robot-1', 'base'), 'robot-link')
    const fixture = proxy(spatialEntityCollisionIdV4('fixture'), 'spatial-entity', 2.05)
    const pair = canonicalCollisionPairKeyV4(robot.entity.id, fixture.entity.id)
    const harness = createPanelHarnessV4({
      projectRevisionId: 'revision-a', policy: policy(), proxies: [robot, fixture],
    })
    const view = render(
      <CollisionPanelV4
        commandBindings={harness.commandBindings}
        controller={harness.controller}
        onFocus={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(screen.getByText('Collisions 0')).toBeVisible()
    expect(screen.getByText('Near-misses 1')).toBeVisible()

    harness.controller.replaceInput({
      projectRevisionId: 'revision-b', policy: policy({ intentionalMountPairKeys: new Set([pair]) }),
      proxies: [robot, fixture], jobRunning: false, query: queryVisibleGeometryCollisionsV4,
    })
    view.rerender(
      <CollisionPanelV4
        commandBindings={harness.commandBindings}
        controller={harness.controller}
        onFocus={vi.fn()}
      />,
    )
    expect(screen.queryByText('Near-misses 1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(screen.getByText('Collisions 0')).toBeVisible()
    expect(screen.getByText('Near-misses 0')).toBeVisible()
  })

  it('disables validation while a Job runs and explains an empty registration', () => {
    const harness = createPanelHarnessV4({
      projectRevisionId: 'revision-a', policy: policy(), proxies: [], jobRunning: true,
    })
    const view = render(
      <CollisionPanelV4
        commandBindings={harness.commandBindings}
        controller={harness.controller}
        onFocus={vi.fn()}
      />,
    )

    expect(screen.getByRole('button', { name: 'Validate Collision' })).toBeDisabled()
    expect(screen.getByText('Collision validation is unavailable for the current Scene.')).toBeVisible()

    harness.controller.replaceInput({
      projectRevisionId: 'revision-b', policy: policy(), proxies: [], jobRunning: false,
      query: queryVisibleGeometryCollisionsV4,
    })
    view.rerender(
      <CollisionPanelV4
        commandBindings={harness.commandBindings}
        controller={harness.controller}
        onFocus={vi.fn()}
      />,
    )
    expect(screen.getByRole('button', { name: 'Validate Collision' })).toBeDisabled()
  })

  it('renders controller-owned rejected-query errors without unhandled click rejection', async () => {
    const user = userEvent.setup()
    const harness = createPanelHarnessV4({
      projectRevisionId: 'revision-error', policy: policy(),
      proxies: [proxy(robotLinkCollisionIdV4('robot-1', 'base'), 'robot-link')],
      query: () => Promise.reject(new Error('Collision query unavailable')),
    })
    render(
      <CollisionPanelV4
        commandBindings={harness.commandBindings}
        controller={harness.controller}
        onFocus={vi.fn()}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Collision query unavailable')
  })

  it('keeps Panel and Menu error-free until their shared Command runtime settles a controller-first rejection', async () => {
    const user = userEvent.setup()
    const delayed = createControllerErrorBeforeRuntimeSettleV4()
    const runtime = createAppCommandRuntimeV4(createAppCommandRegistryV4([{
      id: 'collision.validate',
      label: 'Validate Geometry Collision',
      section: 'simulation',
      kind: 'action',
      visible: true,
      enabled: true,
      execute: () => delayed.controller.validate(),
    }]))
    const commandBindings = createAppCommandBindingsV4(runtime)
    render(<>
      <CollisionPanelV4 commandBindings={commandBindings} controller={delayed.controller} onFocus={vi.fn()} />
      <CollisionCommandMenuV4 commandBindings={commandBindings} />
    </>)

    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(screen.getByRole('button', { name: 'Validating...' })).toBeDisabled()
    expect(screen.getByRole('menuitem', { name: 'Validate Geometry Collision' })).toHaveAttribute('aria-busy', 'true')
    expect(screen.queryByRole('alert')).toBeNull()
    expect(screen.queryByText('Controller reported failure before runtime settlement.')).toBeNull()

    await act(async () => {
      delayed.rejectValidation(new Error('Shared validation failed'))
      await Promise.resolve()
    })

    expect(await screen.findAllByRole('alert')).toHaveLength(2)
    expect(screen.getAllByRole('alert').map((alert) => alert.textContent)).toEqual([
      'Shared validation failed',
      'Shared validation failed',
    ])
    runtime.dispose()
    delayed.controller.dispose()
  })

  it('renders an App-owned controller through StrictMode replay and accepts input replacement', async () => {
    const user = userEvent.setup()
    let resolveFirst!: (value: ReturnType<typeof queryResult>) => void
    let resolveLate!: (value: ReturnType<typeof queryResult>) => void
    const first = new Promise<ReturnType<typeof queryResult>>((resolve) => { resolveFirst = resolve })
    const late = new Promise<ReturnType<typeof queryResult>>((resolve) => { resolveLate = resolve })
    const query = vi.fn().mockReturnValueOnce(first).mockReturnValueOnce(late)
    const robot = proxy(robotLinkCollisionIdV4('robot-strict', 'base'), 'robot-link')
    const harness = createPanelHarnessV4({
      projectRevisionId: 'strict-a', policy: policy(), proxies: [robot], query,
    })
    const view = render(
      <StrictMode>
        <CollisionPanelV4
          commandBindings={harness.commandBindings}
          controller={harness.controller}
          onFocus={vi.fn()}
        />
      </StrictMode>,
    )
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(query).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Validating...' })).toBeDisabled()
    await act(async () => { resolveFirst(queryResult()) })
    expect(await screen.findByText('Collisions 0')).toBeVisible()

    harness.controller.replaceInput({
      projectRevisionId: 'strict-b', policy: policy(), proxies: [robot], jobRunning: false, query,
    })
    view.rerender(
      <StrictMode>
        <CollisionPanelV4
          commandBindings={harness.commandBindings}
          controller={harness.controller}
          onFocus={vi.fn()}
        />
      </StrictMode>,
    )
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(query).toHaveBeenCalledTimes(2)
    view.unmount()
    await act(async () => { resolveLate(queryResult()) })
    await Promise.resolve()
    expect(document.querySelector('[aria-label="Geometry Collision"]')).toBeNull()
    harness.runtime.dispose()
    harness.controller.dispose()
  })
})
