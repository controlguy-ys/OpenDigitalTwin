import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
import type { CollisionFinding } from '../../domain/collision/collision'
import { useInteractionStore } from '../interaction/interaction-store'
import { useRobotStore } from '../joints/robot-store'
import { CollisionValidationClient } from './collision-validation-client'
import type {
  CollisionValidationRequest,
  CollisionValidationResult,
} from './collision-validation-protocol'
import {
  buildCollisionValidationRobotGeometry,
  CollisionPanel,
  type CollisionPanelValidationRuntime,
} from './CollisionPanel'
import { useCollisionStore } from './collision-store'
import {
  geometryEntityRegistry,
  registerGeometryEntity,
} from './geometry-entity-registry'

const COLLISION: CollisionFinding = {
  pairKey: 'object:cup-01|robot-link:LINK03',
  firstEntityId: 'object:cup-01',
  secondEntityId: 'robot-link:LINK03',
  firstBoxId: 'main',
  secondBoxId: 'main',
  kind: 'collision',
  separationM: -0.005,
  sampleIndex: null,
  timeMs: null,
}

const NEAR_MISS: CollisionFinding = {
  pairKey: 'object:fixture-01|robot-link:LINK02',
  firstEntityId: 'object:fixture-01',
  secondEntityId: 'robot-link:LINK02',
  firstBoxId: 'main',
  secondBoxId: 'main',
  kind: 'near-miss',
  separationM: 0.025,
  sampleIndex: null,
  timeMs: null,
}

function seedFindings() {
  const state = useCollisionStore.getState()
  state.replaceCollisionState({
    policy: {
      enabled: true,
      warningDistanceM: 0.05,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
    currentFindings: [COLLISION, NEAR_MISS],
    diagnostics: [
      { entityId: 'object:missing', message: 'Scene object is unavailable.' },
    ],
  })
  state.setSelectedFindingIndex(0)
  state.setPausePlaybackOnCollision(true)
  state.setValidationReport(null)
}

function runtime(
  revision: string,
  overrides: Partial<CollisionPanelValidationRuntime> = {},
): CollisionPanelValidationRuntime {
  return {
    revision,
    canValidate: true,
    createRequest: (mode) => ({ mode, revision }) as CollisionValidationRequest,
    client: {
      validate: vi.fn(() => Promise.reject(new Error('not configured'))),
      cancel: vi.fn(),
    },
    ...overrides,
  }
}

describe('CollisionPanel', () => {
  beforeEach(() => {
    seedFindings()
    useInteractionStore.getState().resetInteraction()
  })

  afterEach(() => {
    geometryEntityRegistry.clear()
    useRobotStore.setState({ keyframes: [] })
    vi.restoreAllMocks()
  })

  function startDefaultValidation() {
    useRobotStore.setState({
      keyframes: [
        {
          id: 'registry-start',
          name: 'Registry start',
          anglesDeg: [0, 0, 0, 0, 0, 0],
          durationMs: 1_000,
          easing: 'linear',
        },
        {
          id: 'registry-end',
          name: 'Registry end',
          anglesDeg: [1, 0, 0, 0, 0, 0],
          durationMs: 1_000,
          easing: 'linear',
        },
      ],
    })
    const validate = vi.spyOn(
      CollisionValidationClient.prototype,
      'validate',
    ).mockImplementation(
      () => new Promise<CollisionValidationResult>(() => undefined),
    )
    const cancel = vi.spyOn(
      CollisionValidationClient.prototype,
      'cancel',
    ).mockImplementation(() => undefined)
    useCollisionStore.getState().setValidationReport({
      revision: 'completed-registry-run',
      sampleCount: 1,
      findings: [COLLISION],
      truncated: false,
    })
    return { validate, cancel }
  }

  it('maps Robot geometry visibility and live registry participation into validation links', () => {
    const identity = {
      position: [0, 0, 0] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
      scale: [1, 1, 1] as [number, number, number],
    }
    const box = {
      id: 'default',
      center: [0, 0, 0] as [number, number, number],
      halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
      quaternion: [0, 0, 0, 1] as [number, number, number, number],
    }

    const geometryLinks = [
      {
        linkId: 'LINK00' as const,
        visible: true,
        localTransform: identity,
        collisionBoxes: [box],
      },
      {
        linkId: 'LINK01' as const,
        visible: false,
        localTransform: identity,
        collisionBoxes: [box],
      },
    ]
    const activeEntityIds = new Set([
      'robot-link:LINK00',
      'robot-link:LINK01',
      'robot-link:LINK02',
    ])
    const hiddenRobotPayload = buildCollisionValidationRobotGeometry(
      geometryLinks,
      activeEntityIds,
      false,
    )

    expect(
      hiddenRobotPayload.linkEntities.every(
        ({ collisionActive }) => !collisionActive,
      ),
    ).toBe(true)

    const payload = buildCollisionValidationRobotGeometry(
      geometryLinks,
      activeEntityIds,
      true,
    )

    expect(payload.linkEntities).toHaveLength(7)
    expect(payload.linkEntities.map(({ linkId, collisionActive }) => ({
      linkId,
      collisionActive,
    }))).toEqual([
      { linkId: 'LINK00', collisionActive: true },
      { linkId: 'LINK01', collisionActive: false },
      { linkId: 'LINK02', collisionActive: true },
      { linkId: 'LINK03', collisionActive: false },
      { linkId: 'LINK04', collisionActive: false },
      { linkId: 'LINK05', collisionActive: false },
      { linkId: 'LINK06', collisionActive: false },
    ])
  })

  it('exposes collision policy with warning distance in millimetres', async () => {
    const user = userEvent.setup()
    render(<CollisionPanel />)

    const enabled = screen.getByRole('checkbox', {
      name: 'Enable geometry collision validation',
    })
    const distance = screen.getByRole('spinbutton', {
      name: 'Warning distance (mm)',
    })
    expect(enabled).toBeChecked()
    expect(distance).toHaveValue(50)

    await user.click(enabled)
    fireEvent.change(distance, { target: { value: '125' } })

    expect(useCollisionStore.getState().policy).toMatchObject({
      enabled: false,
      warningDistanceM: 0.125,
    })
  })

  it('shows live counts, diagnostics, clearance, and the non-safety disclaimer', () => {
    render(<CollisionPanel />)

    expect(screen.getByRole('heading', { name: 'Geometry Proxy Collision' })).toBeVisible()
    expect(screen.getByText('Collision 1')).toBeVisible()
    expect(screen.getByText('Near-miss 1')).toBeVisible()
    expect(screen.getByText('Approximate Clearance')).toBeVisible()
    expect(screen.getByText('-5.000 mm')).toBeVisible()
    expect(
      screen.getByRole('list', { name: 'Collision diagnostics' }),
    ).toHaveTextContent(
      'object:missing: Scene object is unavailable.',
    )
    expect(screen.getByText(/not physics, RobotWare, SafeMove, or safety-rated/i)).toBeVisible()
  })

  it('ignores and restores canonical pairs', async () => {
    const user = userEvent.setup()
    render(<CollisionPanel />)

    await user.click(
      screen.getByRole('button', {
        name: 'Ignore object:cup-01 and robot-link:LINK03',
      }),
    )
    expect(useCollisionStore.getState().policy.ignoredPairKeys).toEqual([
      COLLISION.pairKey,
    ])

    const ignored = screen.getByRole('list', { name: 'Ignored collision pairs' })
    await user.click(within(ignored).getByRole('button', { name: /Restore/ }))
    expect(useCollisionStore.getState().policy.ignoredPairKeys).toEqual([])
  })

  it('navigates findings and toggles optional playback pause', async () => {
    const user = userEvent.setup()
    const sceneObject = new Group()
    sceneObject.position.set(0.4, -0.2, 1.3)
    sceneObject.rotation.set(0.1, 0.2, 0.3)
    const transformBefore = {
      position: sceneObject.position.toArray(),
      quaternion: sceneObject.quaternion.toArray(),
      scale: sceneObject.scale.toArray(),
    }
    render(<CollisionPanel />)

    expect(screen.getByText('Finding 1 of 2')).toBeVisible()
    await user.click(screen.getByRole('button', { name: 'Next finding' }))
    expect(screen.getByText('Finding 2 of 2')).toBeVisible()
    expect(useCollisionStore.getState().selectedFindingIndex).toBe(1)
    await user.click(screen.getByRole('button', { name: 'First finding' }))
    expect(useCollisionStore.getState().selectedFindingIndex).toBe(0)

    const pause = screen.getByRole('checkbox', {
      name: 'Pause Simulation playback on collision',
    })
    await user.click(pause)
    expect(useCollisionStore.getState().pausePlaybackOnCollision).toBe(false)
    expect(sceneObject.position.toArray()).toEqual(transformBefore.position)
    expect(sceneObject.quaternion.toArray()).toEqual(transformBefore.quaternion)
    expect(sceneObject.scale.toArray()).toEqual(transformBefore.scale)
  })

  it('downloads deterministic JSON and CSV reports', async () => {
    const user = userEvent.setup()
    const createObjectURL = vi.fn(() => 'blob:collision-report')
    const revokeObjectURL = vi.fn()
    Object.defineProperty(URL, 'createObjectURL', {
      configurable: true,
      value: createObjectURL,
    })
    Object.defineProperty(URL, 'revokeObjectURL', {
      configurable: true,
      value: revokeObjectURL,
    })
    const click = vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(() => undefined)
    render(<CollisionPanel />)

    await user.click(screen.getByRole('button', { name: 'Download JSON report' }))
    await user.click(screen.getByRole('button', { name: 'Download CSV report' }))

    expect(createObjectURL).toHaveBeenCalledTimes(2)
    expect(click).toHaveBeenCalledTimes(2)
    expect(revokeObjectURL).toHaveBeenCalledTimes(2)
    click.mockRestore()
  })

  it('starts validation, reports progress, and commits the current revision', async () => {
    const user = userEvent.setup()
    let resolveResult!: (result: CollisionValidationResult) => void
    const completion = new Promise<CollisionValidationResult>((resolve) => {
      resolveResult = resolve
    })
    const validate = vi.fn((_request, options) => {
      options?.onProgress?.({
        requestId: 'request-1',
        revision: 'runtime-1',
        processedSamples: 250,
        totalSamples: 1_000,
      })
      return completion
    }) as CollisionPanelValidationRuntime['client']['validate']
    const validationRuntime = runtime('runtime-1', {
      client: { validate, cancel: vi.fn() },
    })
    render(<CollisionPanel validationRuntime={validationRuntime} />)

    await user.click(screen.getByRole('button', { name: 'Validate Sequence' }))

    expect(screen.getByRole('status', { name: 'Sequence validation progress' }))
      .toHaveTextContent('250 / 1000')
    expect(screen.getByRole('button', { name: 'Cancel Validation' })).toBeVisible()

    await act(async () => {
      resolveResult({
        requestId: 'request-1',
        revision: 'runtime-1',
        mode: 'validate',
        sampleCount: 1_000,
        durationMs: 2_000,
        findings: [{ ...COLLISION, sampleIndex: 4, timeMs: 80 }],
        truncated: false,
      })
      await completion
    })

    expect(useCollisionStore.getState().validationReport).toMatchObject({
      revision: 'runtime-1',
      sampleCount: 1_000,
      truncated: false,
    })
    expect(screen.getByRole('button', { name: 'Validate Sequence' })).toBeVisible()
  })

  it('cancels the active sequence validation', async () => {
    const user = userEvent.setup()
    const cancel = vi.fn()
    const validate = vi.fn(
      () => new Promise<CollisionValidationResult>(() => undefined),
    ) as CollisionPanelValidationRuntime['client']['validate']
    render(
      <CollisionPanel
        validationRuntime={runtime('runtime-1', {
          client: { validate, cancel },
        })}
      />,
    )

    await user.click(screen.getByRole('button', { name: 'Preview Sequence' }))
    await user.click(screen.getByRole('button', { name: 'Cancel Validation' }))

    expect(cancel).toHaveBeenCalledTimes(1)
    expect(screen.getByRole('button', { name: 'Preview Sequence' })).toBeVisible()
  })

  it('marks a completed report stale when a relevant revision changes', () => {
    useCollisionStore.getState().setValidationReport({
      revision: 'runtime-1',
      sampleCount: 1,
      findings: [COLLISION],
      truncated: false,
    })
    const { rerender } = render(
      <CollisionPanel validationRuntime={runtime('runtime-1')} />,
    )

    rerender(<CollisionPanel validationRuntime={runtime('runtime-2')} />)

    expect(useCollisionStore.getState().validationReportStale).toBe(true)
  })

  it('marks a completed report stale when a registered collider revision changes', () => {
    const object = new Group()
    registerGeometryEntity({
      id: 'tool:revision-probe',
      name: 'Revision probe',
      category: 'tool',
      boxes: [{
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      }],
      object,
      colliderRevision: 1,
    })
    useCollisionStore.getState().setValidationReport({
      revision: 'runtime-1',
      sampleCount: 1,
      findings: [COLLISION],
      truncated: false,
    })
    const { rerender } = render(<CollisionPanel />)

    registerGeometryEntity({
      id: 'tool:revision-probe',
      name: 'Revision probe',
      category: 'tool',
      boxes: [{
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.2, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      }],
      object,
      colliderRevision: 2,
    })
    rerender(<CollisionPanel />)

    expect(useCollisionStore.getState().validationReportStale).toBe(true)
  })

  it('cancels active validation and marks its report stale on registry mutation without rerender', async () => {
    const user = userEvent.setup()
    const { validate, cancel } = startDefaultValidation()
    render(<CollisionPanel />)
    await user.click(screen.getByRole('button', { name: 'Validate Sequence' }))
    expect(validate).toHaveBeenCalledTimes(1)
    cancel.mockClear()

    act(() => {
      registerGeometryEntity({
        id: 'tool:reactive-probe',
        name: 'Reactive probe',
        category: 'tool',
        boxes: [{
          id: 'default',
          center: [0, 0, 0],
          halfExtents: [0.1, 0.1, 0.1],
          quaternion: [0, 0, 0, 1],
        }],
        object: new Group(),
        colliderRevision: 1,
      })
    })

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(useCollisionStore.getState().validationReportStale).toBe(true)
    })
  })

  it('cancels active validation and marks its report stale when a live registration cleans up', async () => {
    const cleanupRegistration = registerGeometryEntity({
      id: 'tool:cleanup-probe',
      name: 'Cleanup probe',
      category: 'tool',
      boxes: [{
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      }],
      object: new Group(),
      colliderRevision: 1,
    })
    const user = userEvent.setup()
    const { validate, cancel } = startDefaultValidation()
    render(<CollisionPanel />)
    await user.click(screen.getByRole('button', { name: 'Validate Sequence' }))
    expect(validate).toHaveBeenCalledTimes(1)
    cancel.mockClear()

    act(() => cleanupRegistration())

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(useCollisionStore.getState().validationReportStale).toBe(true)
    })
  })

  it('gates all validation Links when the Robot root hides and restores live Link conditions when shown', async () => {
    registerGeometryEntity({
      id: 'robot-link:LINK00',
      name: 'LINK00',
      category: 'robot-link',
      boxes: [{
        id: 'default',
        center: [0, 0, 0],
        halfExtents: [0.1, 0.1, 0.1],
        quaternion: [0, 0, 0, 1],
      }],
      object: new Group(),
    })
    const user = userEvent.setup()
    const { validate, cancel } = startDefaultValidation()
    render(<CollisionPanel />)

    await user.click(screen.getByRole('button', { name: 'Validate Sequence' }))
    expect(validate).toHaveBeenCalledTimes(1)
    expect(
      validate.mock.calls[0]?.[0].robot.linkEntities.find(
        ({ linkId }) => linkId === 'LINK00',
      )?.collisionActive,
    ).toBe(true)
    cancel.mockClear()

    act(() => {
      useInteractionStore.getState().setEntityVisible('robot', false)
    })

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1)
      expect(useCollisionStore.getState().validationReportStale).toBe(true)
    })
    await user.click(screen.getByRole('button', { name: 'Validate Sequence' }))
    expect(validate).toHaveBeenCalledTimes(2)
    expect(
      validate.mock.calls[1]?.[0].robot.linkEntities.every(
        ({ collisionActive }) => !collisionActive,
      ),
    ).toBe(true)
    cancel.mockClear()

    act(() => {
      useInteractionStore.getState().setEntityVisible('robot', true)
    })

    await waitFor(() => {
      expect(cancel).toHaveBeenCalledTimes(1)
    })
    await user.click(screen.getByRole('button', { name: 'Validate Sequence' }))
    expect(validate).toHaveBeenCalledTimes(3)
    expect(
      validate.mock.calls[2]?.[0].robot.linkEntities.map(
        ({ linkId, collisionActive }) => ({ linkId, collisionActive }),
      ),
    ).toEqual([
      { linkId: 'LINK00', collisionActive: true },
      { linkId: 'LINK01', collisionActive: false },
      { linkId: 'LINK02', collisionActive: false },
      { linkId: 'LINK03', collisionActive: false },
      { linkId: 'LINK04', collisionActive: false },
      { linkId: 'LINK05', collisionActive: false },
      { linkId: 'LINK06', collisionActive: false },
    ])
  })

  it('marks a completed report stale when Entity validation visibility changes', () => {
    useCollisionStore.getState().setValidationReport({
      revision: 'runtime-1',
      sampleCount: 1,
      findings: [COLLISION],
      truncated: false,
    })
    render(<CollisionPanel />)

    act(() => {
      useInteractionStore.getState().setEntityVisible('fixture-01', false)
    })

    expect(useCollisionStore.getState().validationReportStale).toBe(true)
  })
})
