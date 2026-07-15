import { act, render } from '@testing-library/react'
import { useMemo } from 'react'
import { describe, expect, it } from 'vitest'
import { useStore } from 'zustand'
import type { CollisionFinding } from '../../domain/collision/collision'
import {
  createCollisionEntityOutlineSelector,
  createCollisionStore,
} from './collision-store'

function finding(
  firstEntityId: string,
  secondEntityId: string,
  kind: CollisionFinding['kind'],
  sampleIndex: number,
): CollisionFinding {
  const [left, right] = [firstEntityId, secondEntityId].sort()
  return {
    pairKey: `${left}|${right}`,
    firstEntityId,
    secondEntityId,
    firstBoxId: 'main',
    secondBoxId: 'main',
    kind,
    separationM: kind === 'collision' ? -0.01 : 0.01,
    sampleIndex,
    timeMs: sampleIndex * 100,
  }
}

describe('collision scene selectors', () => {
  it('rerenders only participants whose scalar selected-finding outline changes', () => {
    const store = createCollisionStore()
    const first = finding('object:a', 'object:b', 'collision', 1)
    const second = finding('object:c', 'object:d', 'near-miss', 2)
    store.getState().setValidationReport({
      revision: 'sequence-1',
      sampleCount: 3,
      findings: [first, second],
      mountContact: null,
      truncated: false,
    })
    const renders = new Map<string, number>()

    function Participant({ entityId }: { entityId: string }) {
      const selector = useMemo(
        () => createCollisionEntityOutlineSelector(entityId),
        [entityId],
      )
      const outline = useStore(store, selector)
      renders.set(entityId, (renders.get(entityId) ?? 0) + 1)
      return <span data-outline={outline ?? 'none'}>{entityId}</span>
    }

    function CanvasBoundary() {
      useStore(store, (state) => state.policy.enabled)
      renders.set('canvas', (renders.get('canvas') ?? 0) + 1)
      return null
    }

    render(
      <>
        {['object:a', 'object:b', 'object:c', 'object:d', 'object:unrelated'].map(
          (entityId) => (
            <Participant entityId={entityId} key={entityId} />
          ),
        )}
        <CanvasBoundary />
      </>,
    )
    const initial = new Map(renders)

    act(() => store.getState().setSelectedFindingIndex(1))

    expect(renders.get('object:a')).toBe(initial.get('object:a')! + 1)
    expect(renders.get('object:b')).toBe(initial.get('object:b')! + 1)
    expect(renders.get('object:c')).toBe(initial.get('object:c')! + 1)
    expect(renders.get('object:d')).toBe(initial.get('object:d')! + 1)
    expect(renders.get('object:unrelated')).toBe(
      initial.get('object:unrelated'),
    )
    expect(renders.get('canvas')).toBe(initial.get('canvas'))
  })

  it('distinguishes collision and near-miss rows for the same pair', () => {
    const store = createCollisionStore()
    store.getState().setValidationReport({
      revision: 'sequence-2',
      sampleCount: 3,
      findings: [
        finding('object:a', 'robot-link:LINK03', 'collision', 1),
        finding('object:a', 'robot-link:LINK03', 'near-miss', 2),
      ],
      mountContact: null,
      truncated: false,
    })
    const objectOutline = createCollisionEntityOutlineSelector('object:a')

    expect(objectOutline(store.getState())).toBe('collision')
    store.getState().setSelectedFindingIndex(1)
    expect(objectOutline(store.getState())).toBe('near-miss')
  })
})
