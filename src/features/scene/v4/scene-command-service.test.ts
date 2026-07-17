import { describe, expect, it } from 'vitest'
import {
  MAX_SCENE_GROUPS_V4,
  MAX_SPATIAL_ENTITIES_V4,
  ProjectV4Error,
  validateWorkcellProjectV4,
  type FrameDefinitionV4,
  type RigidTransformV4,
  type SceneGroupV4,
  type SpatialEntityV4,
  type WorkcellProjectV4,
} from '../../../core/project-v4/index.js'
import {
  makeMinimalWorkcellProjectV4,
  projectAtLimit,
} from '../../../core/project-v4/test-support.js'
import type { ProjectMutationPortV4 } from '../../project/v4/project-mutation-port.js'
import {
  createSceneCommandServiceV4,
  type SceneCommandServiceV4,
} from './scene-command-service.js'

const IDENTITY: RigidTransformV4 = {
  positionM: [0, 0, 0],
  quaternion: [0, 0, 0, 1],
}

const EDITED_POSE: RigidTransformV4 = {
  positionM: [1, 2, 3],
  quaternion: [0, 0, 0, 1],
}

interface PendingMutation {
  readonly recipe: Parameters<ProjectMutationPortV4['replaceFromActive']>[0]
  resolve(value: { readonly project: WorkcellProjectV4 }): void
  reject(reason?: unknown): void
}

class QueuedMutationPortV4 implements ProjectMutationPortV4 {
  active: WorkcellProjectV4
  readonly pending: PendingMutation[] = []
  submitted = 0

  constructor(active: WorkcellProjectV4) {
    this.active = validateWorkcellProjectV4(active)
  }

  replaceFromActive(
    recipe: Parameters<ProjectMutationPortV4['replaceFromActive']>[0],
  ): Promise<{ readonly project: WorkcellProjectV4 }> {
    this.submitted += 1
    return new Promise((resolve, reject) => {
      this.pending.push({ recipe, resolve, reject })
    })
  }

  runNext(current: WorkcellProjectV4 = this.active): void {
    const pending = this.pending.shift()
    if (pending === undefined) throw new Error('No queued mutation recipe.')
    try {
      const project = validateWorkcellProjectV4(pending.recipe.mutate(current))
      this.active = project
      pending.resolve({ project })
    } catch (error) {
      pending.reject(error)
    }
  }
}

function manualStatus(value = 0): SpatialEntityV4['numericStatus'] {
  return {
    value,
    sourceOwnership: 'manual',
    overlay: { visible: true, frameId: null },
  }
}

function entity(
  id: string,
  overrides: Partial<SpatialEntityV4> = {},
): SpatialEntityV4 {
  return {
    id,
    name: id,
    geometry: { kind: 'box', dimensionsM: [1, 1, 1], color: '#808080' },
    parentFrameId: 'world',
    localPose: IDENTITY,
    visible: true,
    groupId: null,
    removable: true,
    transformOwner: 'manual',
    numericStatus: manualStatus(),
    graspable: false,
    graspFrames: [],
    movingFrames: [],
    ...overrides,
  }
}

function group(
  id: string,
  parentGroupId: string | null = null,
  visible = true,
): SceneGroupV4 {
  return { id, name: id, parentGroupId, visible }
}

function authoredProject(): WorkcellProjectV4 {
  const source = structuredClone(makeMinimalWorkcellProjectV4())
  const definition = source.robotDefinitions[0]!
  const extraFrames: readonly FrameDefinitionV4[] = [
    {
      id: 'Tool-Custom',
      name: 'Custom Tool',
      parentFrameId: 'L1',
      localPose: IDENTITY,
      role: 'custom',
    },
    {
      id: 'TCP-Alternate',
      name: 'Alternate TCP',
      parentFrameId: 'Tool-Custom',
      localPose: IDENTITY,
      role: 'tcp',
    },
  ]
  const platform = entity('platform', {
    graspable: true,
    graspFrames: [{ frameId: 'grasp-platform', name: 'Grasp', localPose: IDENTITY }],
    movingFrames: [{
      frameId: 'moving-platform',
      name: 'Moving Platform',
      parentFrameId: 'mcp',
      localPose: IDENTITY,
      sourceOwnership: 'manual',
    }],
  })
  return validateWorkcellProjectV4({
    ...source,
    scene: {
      frames: [
        ...source.scene.frames,
        {
          id: 'fixture-frame',
          name: 'Fixture',
          parentFrameId: 'mcp',
          localPose: IDENTITY,
          role: 'custom',
        },
      ],
    },
    robotDefinitions: [{ ...definition, frames: [...definition.frames, ...extraFrames] }],
    robots: source.robots.map((robot) => ({
      ...robot,
      numericStatus: manualStatus(),
    })),
    sceneGroups: [group('root-group'), group('child-group', 'root-group')],
    spatialEntities: [
      platform,
      entity('child-object', { groupId: 'child-group' }),
      entity('root-object', { groupId: 'root-group' }),
      entity('loose-object'),
    ],
  })
}

interface CommandHarness {
  readonly mutations: QueuedMutationPortV4
  readonly service: SceneCommandServiceV4
  readonly idCalls: () => number
}

function commandHarness(
  project: WorkcellProjectV4 = authoredProject(),
  ids: readonly string[] = ['generated-1', 'generated-2', 'generated-3'],
): CommandHarness {
  const mutations = new QueuedMutationPortV4(project)
  let index = 0
  const service = createSceneCommandServiceV4({
    mutations,
    createId: () => {
      const value = ids[index] ?? `generated-${index + 1}`
      index += 1
      return value
    },
  })
  return { mutations, service, idCalls: () => index }
}

async function runOne<T>(
  harness: CommandHarness,
  command: () => Promise<T>,
  current?: WorkcellProjectV4,
): Promise<T> {
  const before = harness.mutations.submitted
  const result = command()
  expect(harness.mutations.submitted).toBe(before + 1)
  expect(harness.mutations.pending).toHaveLength(1)
  harness.mutations.runNext(current)
  return result
}

async function rejectOne(
  harness: CommandHarness,
  command: () => Promise<unknown>,
  code: string,
  current?: WorkcellProjectV4,
): Promise<void> {
  const before = harness.mutations.submitted
  const result = command()
  const assertion = expect(result).rejects.toMatchObject({ code })
  expect(harness.mutations.submitted).toBe(before + 1)
  expect(harness.mutations.pending).toHaveLength(1)
  harness.mutations.runNext(current)
  await assertion
}

describe('SceneCommandServiceV4', () => {
  it('creates exact Box, Cylinder, and Group defaults with one deterministic ID each', async () => {
    const harness = commandHarness(authoredProject(), ['box-new', 'cylinder-new', 'group-new'])

    await expect(runOne(harness, () => harness.service.createBox({
      name: 'Box',
      parentFrameId: 'fixture-frame',
      localPose: EDITED_POSE,
      dimensionsM: [0.1, 0.2, 0.3],
      color: '#AABBCC',
      groupId: 'root-group',
    }))).resolves.toBe('box-new')
    expect(harness.mutations.active.spatialEntities.at(-1)).toEqual({
      id: 'box-new',
      name: 'Box',
      geometry: { kind: 'box', dimensionsM: [0.1, 0.2, 0.3], color: '#AABBCC' },
      parentFrameId: 'fixture-frame',
      localPose: EDITED_POSE,
      visible: true,
      groupId: 'root-group',
      removable: true,
      transformOwner: 'manual',
      numericStatus: manualStatus(),
      graspable: false,
      graspFrames: [],
      movingFrames: [],
    })

    await expect(runOne(harness, () => harness.service.createCylinder({
      name: 'Cylinder',
      parentFrameId: 'world',
      localPose: IDENTITY,
      radiusM: 0.4,
      heightM: 0.5,
      color: '#112233',
      groupId: null,
    }))).resolves.toBe('cylinder-new')
    expect(harness.mutations.active.spatialEntities.at(-1)?.geometry).toEqual({
      kind: 'cylinder',
      radiusM: 0.4,
      heightM: 0.5,
      axis: 'z',
      radialSegments: 32,
      color: '#112233',
    })

    await expect(runOne(harness, () => harness.service.createGroup('Group', 'root-group')))
      .resolves.toBe('group-new')
    expect(harness.mutations.active.sceneGroups.at(-1)).toEqual({
      id: 'group-new',
      name: 'Group',
      parentGroupId: 'root-group',
      visible: true,
    })
    expect(harness.idCalls()).toBe(3)
    expect(harness.mutations.submitted).toBe(3)
  })

  it('snapshots primitive caller values before a deferred recipe', async () => {
    const harness = commandHarness(authoredProject(), ['snapshotted-box'])
    const dimensions = [1, 2, 3] as [number, number, number]
    const localPose = structuredClone(EDITED_POSE) as {
      positionM: [number, number, number]
      quaternion: [number, number, number, number]
    }
    const command = harness.service.createBox({
      name: 'Snapshot',
      parentFrameId: 'world',
      localPose,
      dimensionsM: dimensions,
      color: '#ABCDEF',
      groupId: null,
    })
    dimensions[0] = 99
    localPose.positionM[0] = 99

    harness.mutations.runNext()
    await command

    const saved = harness.mutations.active.spatialEntities.at(-1)!
    expect(saved.geometry).toMatchObject({ dimensionsM: [1, 2, 3] })
    expect(saved.localPose.positionM).toEqual([1, 2, 3])
  })

  it('snapshots structured selection targets before deferred recipes', async () => {
    const harness = commandHarness()
    const renameTarget = { kind: 'spatial-entity' as const, entityId: 'loose-object' }
    const rename = harness.service.rename(renameTarget, 'Snapshot Rename')
    renameTarget.entityId = 'platform'
    harness.mutations.runNext()
    await rename

    const visibilityTarget = { kind: 'spatial-entity' as const, entityId: 'loose-object' }
    const visibility = harness.service.setPersistedVisibility(visibilityTarget, false)
    visibilityTarget.entityId = 'platform'
    harness.mutations.runNext()
    await visibility

    const statusTarget = { kind: 'spatial-entity' as const, entityId: 'loose-object' }
    const status = harness.service.setNumericStatus(statusTarget, 42)
    statusTarget.entityId = 'platform'
    harness.mutations.runNext()
    await status

    const overlayTarget = { kind: 'spatial-entity' as const, entityId: 'loose-object' }
    const overlay = harness.service.setStatusOverlayVisible(overlayTarget, false)
    overlayTarget.entityId = 'platform'
    harness.mutations.runNext()
    await overlay

    const loose = harness.mutations.active.spatialEntities.find(({ id }) => id === 'loose-object')!
    const platform = harness.mutations.active.spatialEntities.find(({ id }) => id === 'platform')!
    expect(loose).toMatchObject({
      name: 'Snapshot Rename',
      visible: false,
      numericStatus: { value: 42, overlay: { visible: false } },
    })
    expect(platform).toMatchObject({
      name: 'platform',
      visible: true,
      numericStatus: { value: 0, overlay: { visible: true } },
    })
  })

  it('renames every supported target without aliasing equal frame names', async () => {
    const harness = commandHarness()
    const commands = [
      [{ kind: 'robot', robotId: 'robot-1' } as const, 'Robot Renamed'],
      [{ kind: 'spatial-entity', entityId: 'loose-object' } as const, 'Entity Renamed'],
      [{ kind: 'scene-group', groupId: 'root-group' } as const, 'Group Renamed'],
      [{ kind: 'scene-frame', frameId: 'fixture-frame' } as const, 'Frame Renamed'],
      [{ kind: 'entity-frame', entityId: 'platform', frameId: 'grasp-platform' } as const, 'Grasp Renamed'],
      [{ kind: 'entity-frame', entityId: 'platform', frameId: 'moving-platform' } as const, 'Moving Renamed'],
    ] as const

    for (const [target, name] of commands) {
      await runOne(harness, () => harness.service.rename(target, name))
    }

    expect(harness.mutations.active.robots[0]?.name).toBe('Robot Renamed')
    expect(harness.mutations.active.spatialEntities.find(({ id }) => id === 'loose-object')?.name)
      .toBe('Entity Renamed')
    expect(harness.mutations.active.sceneGroups.find(({ id }) => id === 'root-group')?.name)
      .toBe('Group Renamed')
    expect(harness.mutations.active.scene.frames.find(({ id }) => id === 'fixture-frame')?.name)
      .toBe('Frame Renamed')
    const platform = harness.mutations.active.spatialEntities.find(({ id }) => id === 'platform')!
    expect(platform.graspFrames[0]?.name).toBe('Grasp Renamed')
    expect(platform.movingFrames[0]?.name).toBe('Moving Renamed')
  })

  it('sets persisted visibility only on Robot, Spatial Entity, and Group records', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.setPersistedVisibility(
      { kind: 'robot', robotId: 'robot-1' },
      false,
    ))
    await runOne(harness, () => harness.service.setPersistedVisibility(
      { kind: 'spatial-entity', entityId: 'loose-object' },
      false,
    ))
    await runOne(harness, () => harness.service.setPersistedVisibility(
      { kind: 'scene-group', groupId: 'root-group' },
      false,
    ))

    expect(harness.mutations.active.robots[0]?.visible).toBe(false)
    expect(harness.mutations.active.spatialEntities.find(({ id }) => id === 'loose-object')?.visible)
      .toBe(false)
    expect(harness.mutations.active.sceneGroups.find(({ id }) => id === 'root-group')?.visible)
      .toBe(false)
  })

  it('edits manual Entity pose and Group assignment and rejects non-manual ownership', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.setSpatialEntityLocalPose('loose-object', EDITED_POSE))
    await runOne(harness, () => harness.service.setSpatialEntityGroup('loose-object', 'child-group'))

    const edited = harness.mutations.active.spatialEntities.find(({ id }) => id === 'loose-object')!
    expect(edited.localPose).toEqual(EDITED_POSE)
    expect(edited.groupId).toBe('child-group')

    const locked = validateWorkcellProjectV4({
      ...authoredProject(),
      spatialEntities: authoredProject().spatialEntities.map((candidate) => (
        candidate.id === 'loose-object'
          ? { ...candidate, transformOwner: 'simulation' as const }
          : candidate
      )),
    })
    const lockedHarness = commandHarness(locked)
    await rejectOne(
      lockedHarness,
      () => lockedHarness.service.setSpatialEntityLocalPose('loose-object', EDITED_POSE),
      'SPATIAL_ENTITY_TRANSFORM_OWNERSHIP_CONFLICT',
    )
  })

  it('updates Robot Base parent, pose, and intentional mount atomically and excludes Grasp parents', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.setRobotBase({
      robotId: 'robot-1',
      baseParentFrameId: 'moving-platform',
      localBasePose: EDITED_POSE,
      intentionalMountEntityId: 'platform',
    }))

    expect(harness.mutations.active.robots[0]).toMatchObject({
      baseParentFrameId: 'moving-platform',
      localBasePose: EDITED_POSE,
      intentionalMountEntityId: 'platform',
    })

    const before = harness.mutations.active
    await rejectOne(harness, () => harness.service.setRobotBase({
      robotId: 'robot-1',
      baseParentFrameId: 'grasp-platform',
      localBasePose: IDENTITY,
      intentionalMountEntityId: 'platform',
    }), 'ROBOT_BASE_PARENT_INVALID')
    expect(harness.mutations.active).toBe(before)
  })

  it('accepts any Definition frame as Tool but requires a tcp-role TCP', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.setSelectedToolFrames(
      'robot-1',
      'Tool-Custom',
      'TCP-Alternate',
    ))
    expect(harness.mutations.active.robots[0]).toMatchObject({
      selectedToolFrameId: 'Tool-Custom',
      selectedTcpFrameId: 'TCP-Alternate',
    })

    await rejectOne(
      harness,
      () => harness.service.setSelectedToolFrames('robot-1', 'Tool', 'Tool-Custom'),
      'ROBOT_TCP_FRAME_INVALID',
    )
  })

  it('edits non-World Scene frames and rejects the sole World frame', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.setSceneFrameLocalPose('fixture-frame', EDITED_POSE))
    expect(harness.mutations.active.scene.frames.find(({ id }) => id === 'fixture-frame')?.localPose)
      .toEqual(EDITED_POSE)

    await rejectOne(
      harness,
      () => harness.service.setSceneFrameLocalPose('world', EDITED_POSE),
      'WORLD_FRAME_READ_ONLY',
    )
  })

  it('edits an explicitly parented manual Moving Frame and lets validation reject cycles', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.setMovingFrame({
      entityId: 'platform',
      frameId: 'moving-platform',
      parentFrameId: 'fixture-frame',
      localPose: EDITED_POSE,
    }))
    expect(harness.mutations.active.spatialEntities[0]?.movingFrames[0]).toMatchObject({
      parentFrameId: 'fixture-frame',
      localPose: EDITED_POSE,
    })

    await rejectOne(harness, () => harness.service.setMovingFrame({
      entityId: 'platform',
      frameId: 'moving-platform',
      parentFrameId: 'moving-platform',
      localPose: IDENTITY,
    }), 'FRAME_CYCLE')

    const locked = validateWorkcellProjectV4({
      ...authoredProject(),
      spatialEntities: authoredProject().spatialEntities.map((candidate) => (
        candidate.id === 'platform'
          ? {
              ...candidate,
              movingFrames: candidate.movingFrames.map((frame) => ({
                ...frame,
                sourceOwnership: 'simulation' as const,
              })),
            }
          : candidate
      )),
    })
    const lockedHarness = commandHarness(locked)
    await rejectOne(lockedHarness, () => lockedHarness.service.setMovingFrame({
      entityId: 'platform',
      frameId: 'moving-platform',
      parentFrameId: 'world',
      localPose: EDITED_POSE,
    }), 'MOVING_FRAME_OWNERSHIP_CONFLICT')
  })

  it('sets finite manual numeric Status and overlay visibility for Robot and Entity', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.setNumericStatus(
      { kind: 'robot', robotId: 'robot-1' },
      12.5,
    ))
    await runOne(harness, () => harness.service.setStatusOverlayVisible(
      { kind: 'robot', robotId: 'robot-1' },
      false,
    ))
    await runOne(harness, () => harness.service.setNumericStatus(
      { kind: 'spatial-entity', entityId: 'loose-object' },
      -3,
    ))
    await runOne(harness, () => harness.service.setStatusOverlayVisible(
      { kind: 'spatial-entity', entityId: 'loose-object' },
      false,
    ))

    expect(harness.mutations.active.robots[0]?.numericStatus).toMatchObject({
      value: 12.5,
      overlay: { visible: false },
    })
    expect(harness.mutations.active.spatialEntities.find(({ id }) => id === 'loose-object')?.numericStatus)
      .toMatchObject({ value: -3, overlay: { visible: false } })
  })

  it('rejects manual numeric value edits for non-manual Status ownership', async () => {
    const source = authoredProject()
    const locked = validateWorkcellProjectV4({
      ...source,
      spatialEntities: source.spatialEntities.map((candidate) => (
        candidate.id === 'loose-object'
          ? {
              ...candidate,
              numericStatus: {
                ...candidate.numericStatus,
                sourceOwnership: 'simulation' as const,
              },
            }
          : candidate
      )),
    })
    const harness = commandHarness(locked)
    await rejectOne(
      harness,
      () => harness.service.setNumericStatus(
        { kind: 'spatial-entity', entityId: 'loose-object' },
        1,
      ),
      'NUMERIC_STATUS_OWNERSHIP_CONFLICT',
    )
  })

  it('allows overlay visibility to remain a display edit for externally owned Status', async () => {
    const source = authoredProject()
    const locked = validateWorkcellProjectV4({
      ...source,
      spatialEntities: source.spatialEntities.map((candidate) => (
        candidate.id === 'loose-object'
          ? {
              ...candidate,
              numericStatus: {
                ...candidate.numericStatus,
                sourceOwnership: 'simulation' as const,
              },
            }
          : candidate
      )),
    })
    const harness = commandHarness(locked)

    await runOne(harness, () => harness.service.setStatusOverlayVisible(
      { kind: 'spatial-entity', entityId: 'loose-object' },
      false,
    ))

    expect(harness.mutations.active.spatialEntities.find(({ id }) => id === 'loose-object')?.numericStatus)
      .toMatchObject({ sourceOwnership: 'simulation', overlay: { visible: false } })
  })

  it('reparents a Group and rejects a Group parent cycle', async () => {
    const harness = commandHarness()

    await runOne(harness, () => harness.service.reparentGroup('child-group', null))
    expect(harness.mutations.active.sceneGroups.find(({ id }) => id === 'child-group')?.parentGroupId)
      .toBeNull()

    await rejectOne(
      harness,
      () => harness.service.reparentGroup('root-group', 'child-group'),
      'SCENE_GROUP_CYCLE',
      authoredProject(),
    )
  })

  it('ungroups exactly one Group and reparents only its direct children and Entities', async () => {
    const source = authoredProject()
    const nested = validateWorkcellProjectV4({
      ...source,
      sceneGroups: [...source.sceneGroups, group('grandchild-group', 'child-group')],
      spatialEntities: [
        ...source.spatialEntities,
        entity('grandchild-object', { groupId: 'grandchild-group' }),
      ],
    })
    const harness = commandHarness(nested)

    await runOne(harness, () => harness.service.ungroup('child-group'))

    expect(harness.mutations.active.sceneGroups.map(({ id }) => id)).not.toContain('child-group')
    expect(harness.mutations.active.sceneGroups.find(({ id }) => id === 'grandchild-group')?.parentGroupId)
      .toBe('root-group')
    expect(harness.mutations.active.spatialEntities.find(({ id }) => id === 'child-object')?.groupId)
      .toBe('root-group')
    expect(harness.mutations.active.spatialEntities.find(({ id }) => id === 'grandchild-object')?.groupId)
      .toBe('grandchild-group')
  })

  it('deletes a removable unreferenced Spatial Entity but preserves dangling-reference failures', async () => {
    const harness = commandHarness()
    await runOne(harness, () => harness.service.deleteSpatialEntity('loose-object'))
    expect(harness.mutations.active.spatialEntities.some(({ id }) => id === 'loose-object')).toBe(false)

    const referencedSource = authoredProject()
    const referenced = validateWorkcellProjectV4({
      ...referencedSource,
      actions: [{
        id: 'detach-loose',
        kind: 'detach-object',
        objectId: 'loose-object',
      }],
    })
    const referencedHarness = commandHarness(referenced)
    const before = referencedHarness.mutations.active
    await rejectOne(
      referencedHarness,
      () => referencedHarness.service.deleteSpatialEntity('loose-object'),
      'SPATIAL_ENTITY_NOT_FOUND',
    )
    expect(referencedHarness.mutations.active).toBe(before)
    expect(referencedHarness.mutations.active.actions[0]).toEqual(referenced.actions[0])
  })

  it('cascade-deletes a complete Group subtree without deleting Robots', async () => {
    const harness = commandHarness()
    const robot = harness.mutations.active.robots[0]

    await runOne(harness, () => harness.service.deleteGroupAndContents('root-group'))

    expect(harness.mutations.active.sceneGroups).toEqual([])
    expect(harness.mutations.active.spatialEntities.map(({ id }) => id)).toEqual([
      'platform',
      'loose-object',
    ])
    expect(harness.mutations.active.robots[0]).toEqual(robot)
  })

  it('preflights every descendant Entity and rejects cascade deletion when one is non-removable', async () => {
    const source = authoredProject()
    const project = validateWorkcellProjectV4({
      ...source,
      spatialEntities: source.spatialEntities.map((candidate) => (
        candidate.id === 'child-object' ? { ...candidate, removable: false } : candidate
      )),
    })
    const harness = commandHarness(project)
    const before = harness.mutations.active

    await rejectOne(
      harness,
      () => harness.service.deleteGroupAndContents('root-group'),
      'SPATIAL_ENTITY_NOT_REMOVABLE',
    )

    expect(harness.mutations.active).toBe(before)
  })

  it('rejects direct deletion of a non-removable Entity', async () => {
    const source = authoredProject()
    const project = validateWorkcellProjectV4({
      ...source,
      spatialEntities: source.spatialEntities.map((candidate) => (
        candidate.id === 'loose-object' ? { ...candidate, removable: false } : candidate
      )),
    })
    const harness = commandHarness(project)
    await rejectOne(
      harness,
      () => harness.service.deleteSpatialEntity('loose-object'),
      'SPATIAL_ENTITY_NOT_REMOVABLE',
    )
  })

  it('accepts exact Entity and Group limits and rejects one more deterministic create ID', async () => {
    const entityAt255 = projectAtLimit('spatialEntities', MAX_SPATIAL_ENTITIES_V4 - 1)
    const entityPassing = commandHarness(entityAt255, ['entity-256'])
    await runOne(entityPassing, () => entityPassing.service.createBox({
      name: 'Entity 256',
      parentFrameId: 'world',
      localPose: IDENTITY,
      dimensionsM: [1, 1, 1],
      color: '#123456',
      groupId: null,
    }))
    expect(entityPassing.mutations.active.spatialEntities).toHaveLength(MAX_SPATIAL_ENTITIES_V4)

    const entityFailing = commandHarness(entityPassing.mutations.active, ['entity-257'])
    await rejectOne(entityFailing, () => entityFailing.service.createCylinder({
      name: 'Entity 257',
      parentFrameId: 'world',
      localPose: IDENTITY,
      radiusM: 1,
      heightM: 1,
      color: '#123456',
      groupId: null,
    }), 'SPATIAL_ENTITY_LIMIT_EXCEEDED')
    expect(entityFailing.idCalls()).toBe(1)

    const groupAt255 = projectAtLimit('sceneGroups', MAX_SCENE_GROUPS_V4 - 1)
    const groupPassing = commandHarness(groupAt255, ['group-256'])
    await runOne(groupPassing, () => groupPassing.service.createGroup('Group 256', null))
    expect(groupPassing.mutations.active.sceneGroups).toHaveLength(MAX_SCENE_GROUPS_V4)

    const groupFailing = commandHarness(groupPassing.mutations.active, ['group-257'])
    await rejectOne(
      groupFailing,
      () => groupFailing.service.createGroup('Group 257', null),
      'SCENE_GROUP_LIMIT_EXCEEDED',
    )
    expect(groupFailing.idCalls()).toBe(1)
  })

  it('rechecks ownership and target identity against the fresh queued Project', async () => {
    const initial = authoredProject()
    const harness = commandHarness(initial)
    const changed = validateWorkcellProjectV4({
      ...initial,
      spatialEntities: initial.spatialEntities.map((candidate) => (
        candidate.id === 'loose-object'
          ? { ...candidate, transformOwner: 'simulation' as const }
          : candidate
      )),
    })

    await rejectOne(
      harness,
      () => harness.service.setSpatialEntityLocalPose('loose-object', EDITED_POSE),
      'SPATIAL_ENTITY_TRANSFORM_OWNERSHIP_CONFLICT',
      changed,
    )

    expect(harness.mutations.active.spatialEntities.find(({ id }) => id === 'loose-object')?.localPose)
      .toEqual(IDENTITY)
  })

  it('rechecks a generated ID collision inside the queued recipe and returns no ID on failure', async () => {
    const initial = authoredProject()
    const harness = commandHarness(initial, ['fresh-id'])
    const current = validateWorkcellProjectV4({
      ...initial,
      spatialEntities: [...initial.spatialEntities, entity('fresh-id')],
    })

    await rejectOne(harness, () => harness.service.createBox({
      name: 'Collision',
      parentFrameId: 'world',
      localPose: IDENTITY,
      dimensionsM: [1, 1, 1],
      color: '#123456',
      groupId: null,
    }), 'PROJECT_ID_DUPLICATE', current)

    expect(harness.idCalls()).toBe(1)
  })

  it('reports Project errors and leaves the active Project reference unchanged on failed mutation', async () => {
    const harness = commandHarness()
    const before = harness.mutations.active
    const command = harness.service.rename(
      { kind: 'spatial-entity', entityId: 'missing-object' },
      'Missing',
    )
    const assertion = expect(command).rejects.toBeInstanceOf(ProjectV4Error)
    harness.mutations.runNext()
    await assertion
    expect(harness.mutations.active).toBe(before)
  })
})
