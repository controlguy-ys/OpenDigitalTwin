import { render, screen } from '@testing-library/react'
import userEvent from '@testing-library/user-event'
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
import { CollisionPanelV4 } from './CollisionPanel.js'

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

    render(
      <CollisionPanelV4
        onFocus={onFocus}
        policy={policy()}
        projectRevisionId="revision-a"
        proxies={[robot, fixture]}
        query={query}
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
    const view = render(
      <CollisionPanelV4
        onFocus={vi.fn()}
        policy={policy()}
        projectRevisionId="revision-a"
        proxies={[robot, fixture]}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(screen.getByText('Collisions 0')).toBeVisible()
    expect(screen.getByText('Near-misses 1')).toBeVisible()

    view.rerender(
      <CollisionPanelV4
        onFocus={vi.fn()}
        policy={policy({ intentionalMountPairKeys: new Set([pair]) })}
        projectRevisionId="revision-b"
        proxies={[robot, fixture]}
      />,
    )
    expect(screen.queryByText('Near-misses 1')).not.toBeInTheDocument()
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(screen.getByText('Collisions 0')).toBeVisible()
    expect(screen.getByText('Near-misses 0')).toBeVisible()
  })

  it('disables validation while a Job runs and explains an empty registration', () => {
    const view = render(
      <CollisionPanelV4
        jobRunning
        onFocus={vi.fn()}
        policy={policy()}
        projectRevisionId="revision-a"
        proxies={[]}
      />,
    )

    expect(screen.getByRole('button', { name: 'Validate Collision' })).toBeDisabled()
    expect(screen.getByText('No collision Geometry is registered.')).toBeVisible()

    view.rerender(
      <CollisionPanelV4
        onFocus={vi.fn()}
        policy={policy()}
        projectRevisionId="revision-b"
        proxies={[]}
      />,
    )
    expect(screen.getByRole('button', { name: 'Validate Collision' })).toBeDisabled()
  })

  it('renders controller-owned rejected-query errors without unhandled click rejection', async () => {
    const user = userEvent.setup()
    render(
      <CollisionPanelV4
        onFocus={vi.fn()}
        policy={policy()}
        projectRevisionId="revision-error"
        proxies={[proxy(robotLinkCollisionIdV4('robot-1', 'base'), 'robot-link')]}
        query={() => Promise.reject(new Error('Collision query unavailable'))}
      />,
    )
    await user.click(screen.getByRole('button', { name: 'Validate Collision' }))
    expect(await screen.findByRole('alert')).toHaveTextContent('Collision query unavailable')
  })
})
