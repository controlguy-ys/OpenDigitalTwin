import { fireEvent, render, screen, within } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
import { beforeEach, describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
import type { CollisionFinding } from '../../domain/collision/collision'
import { CollisionPanel } from './CollisionPanel'
import { useCollisionStore } from './collision-store'

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
}

describe('CollisionPanel', () => {
  beforeEach(() => {
    seedFindings()
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
})
