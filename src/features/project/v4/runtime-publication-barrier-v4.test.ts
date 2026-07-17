import { describe, expect, it, vi } from 'vitest'
import { createStore } from 'zustand/vanilla'
import type {
  RobotDefinitionGeometryRepositoryV4,
} from '../../robot/v4/robot-definition-geometry-repository.js'
import { createRuntimePublicationBarrierV4 } from './runtime-publication-barrier-v4.js'

interface RevisionStoreState {
  readonly projectRevisionId: string
  publish(projectRevisionId: string): void
}

function revisionStore(projectRevisionId: string) {
  return createStore<RevisionStoreState>()((set) => ({
    projectRevisionId,
    publish: (nextRevisionId) => set((state) => ({
      ...state,
      projectRevisionId: nextRevisionId,
    }), true),
  }))
}

function geometryStub() {
  let snapshot = 0
  const listeners = new Set<() => void>()
  const repository = {
    stage: vi.fn(),
    stageUnresolved: vi.fn(),
    commitBatch: vi.fn(),
    rollback: vi.fn(),
    readCurrent: vi.fn(),
    acquire: vi.fn(),
    revoke: vi.fn(),
    subscribe(listener: () => void) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
    getSnapshot: () => snapshot,
  } as unknown as RobotDefinitionGeometryRepositoryV4
  return {
    repository,
    emit() {
      snapshot += 1
      for (const listener of listeners) listener()
    },
  }
}

describe('Runtime publication barrier V4', () => {
  it('withholds every facade and publishes all snapshots before the first callback', () => {
    const barrier = createRuntimePublicationBarrierV4()
    const rawRobots = revisionStore('revision-a')
    const rawScene = revisionStore('revision-a')
    const robots = barrier.gateStore(rawRobots)
    const scene = barrier.gateStore(rawScene)
    const observations: string[] = []
    robots.subscribe(() => {
      observations.push(
        `${robots.getState().projectRevisionId}:${scene.getState().projectRevisionId}`,
      )
    })
    scene.subscribe(() => {
      observations.push(
        `${robots.getState().projectRevisionId}:${scene.getState().projectRevisionId}`,
      )
    })

    const transaction = barrier.begin()
    rawRobots.getState().publish('revision-b')
    rawScene.getState().publish('revision-b')

    expect(robots.getState().projectRevisionId).toBe('revision-a')
    expect(scene.getState().projectRevisionId).toBe('revision-a')
    expect(observations).toEqual([])

    transaction.commit()

    expect(observations).toEqual([
      'revision-b:revision-b',
      'revision-b:revision-b',
    ])
  })

  it('discards dirty snapshots on rollback and notifies immediately outside a transaction', () => {
    const barrier = createRuntimePublicationBarrierV4()
    const raw = revisionStore('revision-a')
    const gated = barrier.gateStore(raw)
    const listener = vi.fn()
    gated.subscribe(listener)

    const transaction = barrier.begin()
    raw.getState().publish('revision-candidate')
    raw.getState().publish('revision-a')
    transaction.rollback()

    expect(listener).not.toHaveBeenCalled()
    expect(gated.getState().projectRevisionId).toBe('revision-a')

    raw.getState().publish('revision-b')
    expect(listener).toHaveBeenCalledTimes(1)
    expect(gated.getState().projectRevisionId).toBe('revision-b')
  })

  it('advances the public Geometry snapshot once per committed hold only', () => {
    const barrier = createRuntimePublicationBarrierV4()
    const raw = geometryStub()
    const geometry = barrier.gateGeometryRepository(raw.repository)
    const listener = vi.fn()
    geometry.subscribe(listener)

    const committed = barrier.begin()
    raw.emit()
    raw.emit()
    expect(geometry.getSnapshot()).toBe(0)
    committed.commit()
    expect(geometry.getSnapshot()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    const rolledBack = barrier.begin()
    raw.emit()
    rolledBack.rollback()
    expect(geometry.getSnapshot()).toBe(1)
    expect(listener).toHaveBeenCalledTimes(1)

    raw.emit()
    expect(geometry.getSnapshot()).toBe(2)
    expect(listener).toHaveBeenCalledTimes(2)
  })

  it('contains listener failures and keeps releasing later facades', () => {
    const listenerFailure = new Error('listener failed')
    const onListenerError = vi.fn()
    const barrier = createRuntimePublicationBarrierV4({ onListenerError })
    const rawFirst = revisionStore('revision-a')
    const rawSecond = revisionStore('revision-a')
    const first = barrier.gateStore(rawFirst)
    const second = barrier.gateStore(rawSecond)
    const secondListener = vi.fn()
    first.subscribe(() => { throw listenerFailure })
    second.subscribe(secondListener)

    const transaction = barrier.begin()
    rawFirst.getState().publish('revision-b')
    rawSecond.getState().publish('revision-b')
    transaction.commit()

    expect(onListenerError).toHaveBeenCalledWith(listenerFailure)
    expect(secondListener).toHaveBeenCalledTimes(1)
  })
})
