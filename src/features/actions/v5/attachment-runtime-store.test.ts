import { describe, expect, it } from 'vitest'

import {
  prepareAttachTransitionV1,
  prepareDetachTransitionV1,
  type AttachmentRuntimeRecordV1,
  type DetachedPoseOverrideV1,
} from '../../../core/action-runtime-v5/attachment-transition.js'
import { isAttachmentInstructionErrorV1 } from '../../../core/action-runtime-v5/attachment-instruction-error.js'
import {
  type RigidTransformV5,
  type WorkcellProjectV5,
} from '../../../core/project-v5/index.js'
import {
  cloneWorkcellProjectV5,
  makeMinimalWorkcellProjectV5,
} from '../../../core/project-v5/test-support.js'
import { createAttachmentRuntimeStoreV1 } from './attachment-runtime-store.js'

const REVISION_A = 'a'.repeat(64)
const REVISION_B = 'b'.repeat(64)

function pose(positionM: readonly [number, number, number] = [0, 0, 0]): RigidTransformV5 {
  return { positionM, quaternion: [0, 0, 0, 1] }
}

function entity(id: string): WorkcellProjectV5['spatialEntities'][number] {
  return {
    id,
    name: id,
    geometry: { kind: 'box', dimensionsM: [0.1, 0.1, 0.1], color: '#ffffff' },
    parentFrameId: 'mcp',
    localPose: pose(),
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'simulation',
    numericStatus: {
      value: 0,
      sourceOwnership: 'simulation',
      overlay: { visible: false, frameId: null },
    },
    graspable: true,
    graspFrames: [{ frameId: `${id}-grasp`, name: `${id} grasp`, localPose: pose() }],
    movingFrames: [],
  }
}

function projectWithObjects(...objectIds: readonly string[]): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  ;(project.spatialEntities as unknown as WorkcellProjectV5['spatialEntities'][number][]).push(
    ...objectIds.map(entity),
  )
  return project
}

function attachment(
  objectId: string,
  overrides: {
    readonly robotId?: string
    readonly simulationMs?: number
    readonly objectWorldPose?: RigidTransformV5
    readonly toolWorldPose?: RigidTransformV5
  } = {},
): AttachmentRuntimeRecordV1 {
  const objectWorldPose = overrides.objectWorldPose ?? pose([0.1, 0.2, 0.3])
  const toolWorldPose = overrides.toolWorldPose ?? pose([0.1, 0.2, 0.3])
  return prepareAttachTransitionV1({
    id: `attach-${objectId}`,
    kind: 'attach',
    objectId,
    toolFrameId: 'Tool',
    objectGraspFrameId: `${objectId}-grasp`,
    maximumDistanceM: 1,
  }, {
    robotId: overrides.robotId ?? 'robot-1',
    objectTransformOwner: 'simulation',
    existingAttachment: null,
    objectWorldPose,
    toolWorldPose,
    objectGraspLocalPose: pose(),
    simulationMs: overrides.simulationMs ?? 10,
  }).record
}

function detachedOverride(
  record: AttachmentRuntimeRecordV1,
  simulationMs = 20,
): DetachedPoseOverrideV1 {
  return prepareDetachTransitionV1({
    id: `detach-${record.objectId}`,
    kind: 'detach',
    objectId: record.objectId,
    targetParentFrameId: 'mcp',
  }, {
    robotId: record.robotId,
    attachment: record,
    currentToolWorldPose: pose([0.4, 0.5, 0.6]),
    targetParentFrameId: 'mcp',
    targetParentWorldPose: pose(),
    simulationMs,
  }).override
}

function expectAttachmentFailure(operation: () => void, code: string): void {
  let failure: unknown
  try {
    operation()
  } catch (candidate) {
    failure = candidate
  }
  expect(isAttachmentInstructionErrorV1(failure)).toBe(true)
  expect(failure).toMatchObject({ code })
}

describe('AttachmentRuntimeStoreV1', () => {
  it('supports empty or complete initialization and rejects either half of a Project/config pair', () => {
    const empty = createAttachmentRuntimeStoreV1()
    expect(empty.getState()).toMatchObject({ projectRevisionId: null, configRevision: null })
    expect(Object.isFrozen(empty.getState())).toBe(true)
    expect(Object.keys(empty.getState().attachmentsByObjectId)).toEqual([])
    expect(Object.keys(empty.getState().detachedOverridesByObjectId)).toEqual([])
    expect(Object.isFrozen(empty.getState().attachmentsByObjectId)).toBe(true)
    expect(Object.isFrozen(empty.getState().detachedOverridesByObjectId)).toBe(true)

    const initialized = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    expect(initialized.getState()).toMatchObject({ projectRevisionId: 'revision-1', configRevision: REVISION_A })

    const create = createAttachmentRuntimeStoreV1 as unknown as (
      project?: WorkcellProjectV5,
      configRevision?: string,
    ) => unknown
    expect(() => create(projectWithObjects('cup'))).toThrow(TypeError)
    expect(() => create(undefined, REVISION_A)).toThrow(TypeError)
  })

  it('publishes Attach, Detach, and Reattach as mutually exclusive Object states', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    const first = attachment('cup')
    const override = detachedOverride(first)

    store.getState().commitAttach(first)
    const firstStored = store.getState().attachmentsByObjectId.cup!
    expect(firstStored).not.toBe(first)
    expect(firstStored).toEqual(first)
    expect(Object.hasOwn(store.getState().detachedOverridesByObjectId, 'cup')).toBe(false)

    store.getState().commitDetach(override, firstStored)
    expect(Object.hasOwn(store.getState().attachmentsByObjectId, 'cup')).toBe(false)
    expect(store.getState().detachedOverridesByObjectId.cup).toEqual(override)
    expect(store.getState().detachedOverridesByObjectId.cup).not.toBe(override)

    const second = attachment('cup', { simulationMs: 30 })
    store.getState().commitAttach(second)
    expect(store.getState().attachmentsByObjectId.cup).not.toBe(second)
    expect(store.getState().attachmentsByObjectId.cup).toEqual(second)
    expect(Object.hasOwn(store.getState().detachedOverridesByObjectId, 'cup')).toBe(false)

    const stateBeforeRejectedAttach = store.getState()
    expectAttachmentFailure(
      () => store.getState().commitAttach(attachment('cup', { simulationMs: 40 })),
      'ALREADY_ATTACHED',
    )
    expect(store.getState()).toBe(stateBeforeRejectedAttach)
  })

  it('uses exact attachment identity as the Detach compare-and-swap fence', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    const stale = attachment('cup', { simulationMs: 10 })
    store.getState().commitAttach(stale)
    const staleStored = store.getState().attachmentsByObjectId.cup!
    const staleOverride = detachedOverride(staleStored, 20)
    store.getState().commitDetach(staleOverride, staleStored)
    expectAttachmentFailure(
      () => store.getState().commitDetach(staleOverride, staleStored),
      'NOT_ATTACHED',
    )

    const replacement = attachment('cup', { simulationMs: 30 })
    store.getState().commitAttach(replacement)
    const replacementStored = store.getState().attachmentsByObjectId.cup!
    const stateBeforeStaleCommit = store.getState()

    expectAttachmentFailure(
      () => store.getState().commitDetach(staleOverride, staleStored),
      'SOURCE_OWNERSHIP_CONFLICT',
    )
    expect(store.getState()).toBe(stateBeforeStaleCommit)
    expect(store.getState().attachmentsByObjectId.cup).toBe(replacementStored)

    const equalButNotIdentical = structuredClone(replacementStored)
    expectAttachmentFailure(
      () => store.getState().commitDetach(detachedOverride(replacementStored, 40), equalButNotIdentical),
      'SOURCE_OWNERSHIP_CONFLICT',
    )
    expect(store.getState().attachmentsByObjectId.cup).toBe(replacementStored)
  })

  it('handles constructor and __proto__ as exact Object IDs in null-prototype maps', () => {
    const store = createAttachmentRuntimeStoreV1(
      projectWithObjects('constructor', '__proto__'),
      REVISION_A,
    )
    const constructorRecord = attachment('constructor')
    const protoRecord = attachment('__proto__')

    store.getState().commitAttach(constructorRecord)
    store.getState().commitAttach(protoRecord)

    const attachments = store.getState().attachmentsByObjectId
    expect(Object.getPrototypeOf(attachments)).toBeNull()
    expect(Object.hasOwn(attachments, 'constructor')).toBe(true)
    expect(Object.hasOwn(attachments, '__proto__')).toBe(true)
    expect(attachments.constructor).toEqual(constructorRecord)
    expect(attachments.constructor).not.toBe(constructorRecord)
    expect(attachments.__proto__).toEqual(protoRecord)
    expect(attachments.__proto__).not.toBe(protoRecord)
  })

  it('replaceProject and reset clear both runtime maps in one atomic publication', () => {
    const project = projectWithObjects('attached', 'detached')
    const store = createAttachmentRuntimeStoreV1(project, REVISION_A)
    const attached = attachment('attached')
    const detached = attachment('detached')
    store.getState().commitAttach(attached)
    store.getState().commitAttach(detached)
    const detachedStored = store.getState().attachmentsByObjectId.detached!
    store.getState().commitDetach(detachedOverride(detachedStored), detachedStored)

    const publications: Array<{
      readonly revision: string | null
      readonly attachments: readonly string[]
      readonly overrides: readonly string[]
    }> = []
    const unsubscribe = store.subscribe((state) => {
      publications.push({
        revision: state.configRevision,
        attachments: Object.keys(state.attachmentsByObjectId),
        overrides: Object.keys(state.detachedOverridesByObjectId),
      })
    })

    const replacement = cloneWorkcellProjectV5(project)
    ;(replacement as unknown as { revisionId: string }).revisionId = 'revision-2'
    store.getState().replaceProject(replacement, REVISION_B)
    expect(publications).toEqual([{
      revision: REVISION_B,
      attachments: [],
      overrides: [],
    }])

    const reattached = attachment('attached', { simulationMs: 100 })
    store.getState().commitAttach(reattached)
    publications.length = 0
    store.getState().reset(replacement, REVISION_B)
    expect(publications).toEqual([{
      revision: REVISION_B,
      attachments: [],
      overrides: [],
    }])
    unsubscribe()
  })

  it('preserves the exact public snapshot and sends no notification when replacement validation fails', () => {
    const project = projectWithObjects('cup')
    const store = createAttachmentRuntimeStoreV1(project, REVISION_A)
    store.getState().commitAttach(attachment('cup'))
    const before = store.getState()
    const beforeAttachments = before.attachmentsByObjectId
    const beforeOverrides = before.detachedOverridesByObjectId
    let notifications = 0
    const unsubscribe = store.subscribe(() => { notifications += 1 })
    const invalid = cloneWorkcellProjectV5(project)
    ;(invalid.spatialEntities[0] as unknown as { parentFrameId: string }).parentFrameId = 'missing-parent'

    expect(() => store.getState().replaceProject(invalid, REVISION_B)).toThrow()
    expect(store.getState()).toBe(before)
    expect(store.getState().attachmentsByObjectId).toBe(beforeAttachments)
    expect(store.getState().detachedOverridesByObjectId).toBe(beforeOverrides)
    expect(store.getState()).toMatchObject({ projectRevisionId: 'revision-1', configRevision: REVISION_A })
    expect(notifications).toBe(0)
    unsubscribe()
  })

  it('rejects listener reentry so every listener observes one atomic Attachment state', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    const record = attachment('cup')
    const override = detachedOverride(record)
    const observations: string[] = []
    let reentryAttempted = false

    const unsubscribeFirst = store.subscribe((state) => {
      observations.push(`first:${Object.hasOwn(state.attachmentsByObjectId, 'cup')}:${Object.hasOwn(state.detachedOverridesByObjectId, 'cup')}`)
      if (!reentryAttempted) {
        reentryAttempted = true
        state.commitDetach(override, record)
      }
    })
    const unsubscribeSecond = store.subscribe((state) => {
      observations.push(`second:${Object.hasOwn(state.attachmentsByObjectId, 'cup')}:${Object.hasOwn(state.detachedOverridesByObjectId, 'cup')}`)
    })

    expect(() => store.getState().commitAttach(record)).not.toThrow()
    expect(observations).toEqual(['first:true:false', 'second:true:false'])
    expect(store.getState().attachmentsByObjectId.cup).toEqual(record)
    expect(store.getState().attachmentsByObjectId.cup).not.toBe(record)
    expect(Object.hasOwn(store.getState().detachedOverridesByObjectId, 'cup')).toBe(false)
    unsubscribeFirst()
    unsubscribeSecond()
  })

  it('isolates a throwing subscriber and still delivers the committed state to later subscribers', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    const record = attachment('cup')
    const delivered: AttachmentRuntimeRecordV1[] = []
    const unsubscribeThrowing = store.subscribe(() => { throw new Error('listener failed') })
    const unsubscribeLater = store.subscribe((state) => {
      const committed = state.attachmentsByObjectId.cup
      if (committed !== undefined) delivered.push(committed)
    })

    expect(() => store.getState().commitAttach(record)).not.toThrow()
    expect(store.getState().attachmentsByObjectId.cup).toEqual(record)
    expect(store.getState().attachmentsByObjectId.cup).not.toBe(record)
    expect(delivered).toEqual([store.getState().attachmentsByObjectId.cup])
    unsubscribeThrowing()
    unsubscribeLater()
  })

  it('deep-freezes records, nested poses, public maps, and keeps action identities stable', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    const initialActions = {
      replaceProject: store.getState().replaceProject,
      reset: store.getState().reset,
      commitAttach: store.getState().commitAttach,
      commitDetach: store.getState().commitDetach,
    }
    const record = attachment('cup')
    store.getState().commitAttach(record)
    const attachedState = store.getState()
    const storedRecord = attachedState.attachmentsByObjectId.cup!

    expect(Object.isFrozen(attachedState)).toBe(true)
    expect(Object.isFrozen(attachedState.attachmentsByObjectId)).toBe(true)
    expect(Object.isFrozen(attachedState.attachmentsByObjectId.cup)).toBe(true)
    expect(Object.isFrozen(attachedState.attachmentsByObjectId.cup!.toolFromObject)).toBe(true)
    expect(Object.isFrozen(attachedState.attachmentsByObjectId.cup!.toolFromObject.positionM)).toBe(true)
    expect(Object.isFrozen(attachedState.attachmentsByObjectId.cup!.toolFromObject.quaternion)).toBe(true)

    const override = detachedOverride(storedRecord)
    store.getState().commitDetach(override, storedRecord)
    const detachedState = store.getState()
    expect(Object.isFrozen(detachedState)).toBe(true)
    expect(Object.isFrozen(detachedState.detachedOverridesByObjectId)).toBe(true)
    expect(Object.isFrozen(detachedState.detachedOverridesByObjectId.cup)).toBe(true)
    expect(Object.isFrozen(detachedState.detachedOverridesByObjectId.cup!.localPose.positionM)).toBe(true)
    expect(Object.isFrozen(detachedState.detachedOverridesByObjectId.cup!.objectWorldPoseAtDetach.quaternion)).toBe(true)
    expect(detachedState.replaceProject).toBe(initialActions.replaceProject)
    expect(detachedState.reset).toBe(initialActions.reset)
    expect(detachedState.commitAttach).toBe(initialActions.commitAttach)
    expect(detachedState.commitDetach).toBe(initialActions.commitDetach)
  })

  it('canonicalizes copies without freezing or aliasing caller records and rejects invalid values precommit', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    const callerRecord = structuredClone(attachment('cup'))
    store.getState().commitAttach(callerRecord)
    const stored = store.getState().attachmentsByObjectId.cup!

    expect(stored).not.toBe(callerRecord)
    expect(stored.toolFromObject).not.toBe(callerRecord.toolFromObject)
    expect(Object.isFrozen(callerRecord)).toBe(false)
    expect(Object.isFrozen(callerRecord.toolFromObject.positionM)).toBe(false)
    ;(callerRecord.toolFromObject.positionM as [number, number, number])[0] = 99
    expect(stored.toolFromObject.positionM[0]).not.toBe(99)

    const storeBeforeInvalid = store.getState()
    const invalidOverride = structuredClone(detachedOverride(stored))
    ;(invalidOverride.localPose.positionM as [number, number, number])[0] = Number.NaN
    expect(() => store.getState().commitDetach(invalidOverride, stored)).toThrow()
    expect(store.getState()).toBe(storeBeforeInvalid)
    expect(Object.isFrozen(invalidOverride)).toBe(false)

    const freshStore = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    const invalidRecord = structuredClone(attachment('cup'))
    ;(invalidRecord as { attachedAtSimulationMs: number }).attachedAtSimulationMs = Number.POSITIVE_INFINITY
    const before = freshStore.getState()
    expect(() => freshStore.getState().commitAttach(invalidRecord)).toThrow()
    expect(freshStore.getState()).toBe(before)
    expect(Object.isFrozen(invalidRecord)).toBe(false)
  })

  it('allows any validated global scene, Grasp, or Moving Frame as a Detach parent', () => {
    const project = cloneWorkcellProjectV5(projectWithObjects('cup', 'fixture'))
    ;(project.spatialEntities[1]!.movingFrames as unknown as WorkcellProjectV5['spatialEntities'][number]['movingFrames'][number][]).push({
      frameId: 'fixture-moving',
      name: 'Fixture moving',
      parentFrameId: 'mcp',
      localPose: pose(),
      sourceOwnership: 'simulation',
    })
    const store = createAttachmentRuntimeStoreV1(project, REVISION_A)
    store.getState().commitAttach(attachment('cup'))
    const stored = store.getState().attachmentsByObjectId.cup!
    const override = { ...detachedOverride(stored), parentFrameId: 'fixture-moving' }

    expect(() => store.getState().commitDetach(override, stored)).not.toThrow()
    expect(store.getState().detachedOverridesByObjectId.cup?.parentFrameId).toBe('fixture-moving')
  })

  it('preserves listed active and CAS failure precedence over malformed pose payloads', () => {
    const store = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    store.getState().commitAttach(attachment('cup'))
    const current = store.getState().attachmentsByObjectId.cup!
    const malformedAttach = structuredClone(attachment('cup', { simulationMs: 99 }))
    ;(malformedAttach.toolFromObject.positionM as [number, number, number])[0] = Number.NaN
    expectAttachmentFailure(() => store.getState().commitAttach(malformedAttach), 'ALREADY_ATTACHED')

    const malformedOverride = structuredClone(detachedOverride(current))
    ;(malformedOverride.localPose.quaternion as [number, number, number, number])[0] = Number.NaN
    expectAttachmentFailure(
      () => store.getState().commitDetach(malformedOverride, structuredClone(current)),
      'SOURCE_OWNERSHIP_CONFLICT',
    )

    const empty = createAttachmentRuntimeStoreV1(projectWithObjects('cup'), REVISION_A)
    expectAttachmentFailure(
      () => empty.getState().commitDetach(malformedOverride, current),
      'NOT_ATTACHED',
    )
    expect(Object.isFrozen(malformedAttach)).toBe(false)
    expect(Object.isFrozen(malformedOverride)).toBe(false)
  })
})
