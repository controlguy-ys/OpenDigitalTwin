import { describe, expect, it, vi } from 'vitest'
import type { CollisionFinding } from '../../domain/collision/collision'
import { CRB15000_DEFINITION, type RobotLinkId } from '../../domain/robot/crb15000'
import {
  CollisionValidationCancelledError,
  CollisionValidationClient,
  StaleCollisionValidationResultError,
  type CollisionValidationWorkerLike,
} from './collision-validation-client'
import type {
  CollisionValidationRequest,
  CollisionValidationResult,
  CollisionValidationWorkerEvent,
} from './collision-validation-protocol'

type WorkerListener = (event: { data?: unknown; message?: string }) => void

class FakeWorker implements CollisionValidationWorkerLike {
  readonly messages: unknown[] = []
  readonly listeners = new Map<string, Set<WorkerListener>>()
  terminated = false

  addEventListener(type: 'message' | 'error', listener: WorkerListener): void {
    const listeners = this.listeners.get(type) ?? new Set()
    listeners.add(listener)
    this.listeners.set(type, listeners)
  }

  removeEventListener(type: 'message' | 'error', listener: WorkerListener): void {
    this.listeners.get(type)?.delete(listener)
  }

  postMessage(message: unknown): void {
    this.messages.push(message)
  }

  terminate(): void {
    this.terminated = true
  }

  emitMessage(data: CollisionValidationWorkerEvent): void {
    for (const listener of this.listeners.get('message') ?? []) listener({ data })
  }

  emitError(message: string): void {
    for (const listener of this.listeners.get('error') ?? []) listener({ message })
  }
}

const LINK_IDS: readonly RobotLinkId[] = [
  'LINK00', 'LINK01', 'LINK02', 'LINK03', 'LINK04', 'LINK05', 'LINK06',
]
const IDENTITY = {
  position: [0, 0, 0] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
  scale: [1, 1, 1] as [number, number, number],
}
const BOX = {
  id: 'default',
  center: [0, 0, 0] as [number, number, number],
  halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
  quaternion: [0, 0, 0, 1] as [number, number, number, number],
}

function request(revision = 'scene-7'): CollisionValidationRequest {
  return {
    requestId: `validation-${revision}`,
    revision,
    mode: 'preview',
    sequence: [
      { id: 'a', name: 'A', anglesDeg: [0, 0, 0, 0, 0, 0], durationMs: 100, easing: 'linear' },
      { id: 'b', name: 'B', anglesDeg: [2, 0, 0, 0, 0, 0], durationMs: 100, easing: 'linear' },
    ],
    robot: {
      definition: CRB15000_DEFINITION,
      rootPose: IDENTITY,
      geometryTransforms: Object.fromEntries(
        LINK_IDS.map((linkId) => [linkId, IDENTITY]),
      ) as Record<RobotLinkId, typeof IDENTITY>,
      toolFrames: { flange: IDENTITY, tool: IDENTITY, tcp: IDENTITY },
      linkEntities: LINK_IDS.map((linkId) => ({
        linkId,
        id: `robot-link:${linkId}` as const,
        name: linkId,
        boxes: [BOX],
      })),
      toolEntity: null,
    },
    heldObject: null,
    staticEntities: [],
    policy: {
      enabled: true,
      warningDistanceM: 0.05,
      ignoredPairKeys: [],
      enabledRobotSelfPairs: [],
    },
  }
}

function result(
  candidate: CollisionValidationRequest,
  findings: readonly CollisionFinding[] = [],
): CollisionValidationResult {
  return {
    requestId: candidate.requestId,
    revision: candidate.revision,
    mode: candidate.mode,
    sampleCount: 2,
    durationMs: 100,
    findings,
    truncated: false,
  }
}

describe('CollisionValidationClient', () => {
  it('publishes monotonic progress and ignores regressive updates', async () => {
    const worker = new FakeWorker()
    const client = new CollisionValidationClient(() => worker)
    const candidate = request()
    const onProgress = vi.fn()
    const completion = client.validate(candidate, { onProgress })

    worker.emitMessage({
      type: 'progress',
      progress: {
        requestId: candidate.requestId,
        revision: candidate.revision,
        processedSamples: 250,
        totalSamples: 1_000,
      },
    })
    worker.emitMessage({
      type: 'progress',
      progress: {
        requestId: candidate.requestId,
        revision: candidate.revision,
        processedSamples: 100,
        totalSamples: 1_000,
      },
    })
    worker.emitMessage({
      type: 'progress',
      progress: {
        requestId: candidate.requestId,
        revision: candidate.revision,
        processedSamples: 500,
        totalSamples: 1_000,
      },
    })
    worker.emitMessage({ type: 'result', result: result(candidate) })

    await expect(completion).resolves.toMatchObject({ revision: 'scene-7' })
    expect(onProgress.mock.calls.map(([progress]) => progress.processedSamples)).toEqual([
      250, 500,
    ])
    expect(worker.messages[0]).toMatchObject({
      type: 'validate',
      request: { requestId: candidate.requestId },
    })
  })

  it('sends cancel and rejects the active run without accepting late results', async () => {
    const worker = new FakeWorker()
    const client = new CollisionValidationClient(() => worker)
    const candidate = request()
    const completion = client.validate(candidate)

    client.cancel()
    worker.emitMessage({ type: 'result', result: result(candidate) })

    await expect(completion).rejects.toBeInstanceOf(
      CollisionValidationCancelledError,
    )
    expect(worker.messages.at(-1)).toEqual({
      type: 'cancel',
      requestId: candidate.requestId,
    })
  })

  it('rejects a result when the relevant runtime revision changed', async () => {
    const worker = new FakeWorker()
    const client = new CollisionValidationClient(() => worker)
    const candidate = request()
    const completion = client.validate(candidate, {
      getCurrentRevision: () => 'scene-8',
    })

    worker.emitMessage({ type: 'result', result: result(candidate) })

    await expect(completion).rejects.toBeInstanceOf(
      StaleCollisionValidationResultError,
    )
  })

  it('recovers with a fresh Worker after a Worker error', async () => {
    const workers = [new FakeWorker(), new FakeWorker()]
    let factoryIndex = 0
    const client = new CollisionValidationClient(() => workers[factoryIndex++]!)
    const firstRequest = request('scene-1')
    const first = client.validate(firstRequest)

    workers[0]!.emitError('worker failed')

    await expect(first).rejects.toThrow('worker failed')
    expect(workers[0]!.terminated).toBe(true)

    const secondRequest = request('scene-2')
    const second = client.validate(secondRequest)
    workers[1]!.emitMessage({ type: 'result', result: result(secondRequest) })

    await expect(second).resolves.toMatchObject({ revision: 'scene-2' })
    expect(factoryIndex).toBe(2)
  })

  it('ignores messages for an older request id', async () => {
    const worker = new FakeWorker()
    const client = new CollisionValidationClient(() => worker)
    const candidate = request('current')
    const completion = client.validate(candidate)

    const staleRequest = request('old')
    worker.emitMessage({ type: 'result', result: result(staleRequest) })
    worker.emitMessage({ type: 'result', result: result(candidate) })

    await expect(completion).resolves.toMatchObject({ revision: 'current' })
  })
})
