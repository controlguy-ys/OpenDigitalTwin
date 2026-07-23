import { describe, expect, it } from 'vitest'

import {
  createProductCommandStagingV1,
  type ProductCommandTargetV1,
} from './opcua-command-staging.js'

const REVISION = 'a'.repeat(64)

const poseTarget: ProductCommandTargetV1 = {
  targetId: 'box-1', projectId: 'project-v5', revisionId: 'revision-1', configRevision: REVISION,
  payload: { kind: 'scene-object-pose', objectId: 'box-1' },
}

function stagePose(
  staging: ReturnType<typeof createProductCommandStagingV1>,
  sessionId = 'session-a',
): void {
  staging.write(sessionId, poseTarget, 'RequestId', 'request-a', 1_000)
  staging.write(sessionId, poseTarget, 'ExpiresAt', 2_000, 1_000)
  for (const [field, value] of Object.entries({ X: 1, Y: 2, Z: 3, Roll: 0, Pitch: 0, Yaw: 0 })) {
    staging.write(sessionId, poseTarget, field, value, 1_000)
  }
}

describe('ProductCommandStagingV1', () => {
  it('never combines fields staged by different sessions', () => {
    const staging = createProductCommandStagingV1()
    staging.write('session-a', poseTarget, 'RequestId', 'request-a', 1_000)
    staging.write('session-a', poseTarget, 'ExpiresAt', 2_000, 1_000)
    staging.write('session-b', poseTarget, 'X', 1, 1_000)

    expect(() => staging.write('session-a', poseTarget, 'Execute', true, 1_000))
      .toThrow('COMMAND_STAGE_INCOMPLETE')
  })

  it('creates one snapshot only for a false-to-true Execute edge', () => {
    const staging = createProductCommandStagingV1()
    stagePose(staging)
    staging.write('session-a', poseTarget, 'Execute', false, 1_000)
    const snapshot = staging.write('session-a', poseTarget, 'Execute', true, 1_001)
    expect(staging.write('session-a', poseTarget, 'Execute', true, 1_002)).toBeNull()

    expect(snapshot).toEqual({
      requestId: 'request-a', expiresAt: 2_000, projectId: 'project-v5', revisionId: 'revision-1',
      configRevision: REVISION, sessionId: 'session-a', targetId: 'box-1',
      payload: { kind: 'scene-object-pose', objectId: 'box-1', pose: { x: 1, y: 2, z: 3, roll: 0, pitch: 0, yaw: 0 } },
    })
  })

  it.each([
    ['expired', 1_000, 'COMMAND_EXPIRED'],
    ['beyond the sixty second staging window', 61_001, 'COMMAND_EXPIRY_INVALID'],
  ])('rejects %s expiry on complete snapshot', (_name, expiresAt, code) => {
    const staging = createProductCommandStagingV1()
    stagePose(staging)
    staging.write('session-a', poseTarget, 'ExpiresAt', expiresAt, 1_000)
    expect(() => staging.write('session-a', poseTarget, 'Execute', true, 1_000)).toThrow(code)
  })

  it('clears a stale partial stage and clears the session on close', () => {
    const staging = createProductCommandStagingV1()
    staging.write('session-a', poseTarget, 'RequestId', 'request-a', 1_000)
    staging.write('session-a', poseTarget, 'ExpiresAt', 2_000, 61_000)
    expect(() => staging.write('session-a', poseTarget, 'Execute', true, 61_000))
      .toThrow('COMMAND_STAGE_INCOMPLETE')
    staging.closeSession('session-a')
    expect(staging.size()).toBe(0)
  })
})
