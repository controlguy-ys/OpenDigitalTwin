import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { V6WorkcellSelection } from '../../interaction/v6/workcell-selection-v6.js'
import type { ProjectV5MutationService } from '../../project/v5/project-v5-mutation-service.js'

export interface SceneCommandServiceV6 {
  rename(selection: Extract<V6WorkcellSelection, { readonly kind: 'robot' | 'entity' | 'group' }>, name: string): Promise<void>
  setVisibility(selection: Extract<V6WorkcellSelection, { readonly kind: 'robot' | 'entity' | 'group' }>, visible: boolean): Promise<void>
  duplicateEntity(entityId: string): Promise<string>
  deleteEntity(entityId: string): Promise<void>
  deleteGroup(groupId: string): Promise<void>
}

type SceneMutableSelectionV6 = Extract<V6WorkcellSelection, { readonly kind: 'robot' | 'entity' | 'group' }>

export interface SceneCommandServiceV6Options {
  readonly mutations: ProjectV5MutationService
  readonly createId: () => string
  readonly onSelectionChange?: (selection: V6WorkcellSelection | null) => void
}

function fail(message: string): never { throw new Error(message) }

function activePublication(mutations: ProjectV5MutationService): { readonly project: WorkcellProjectV5; readonly revisionId: string } {
  const published = mutations.readPublished()
  if (published === null) return fail('No published Project V5 revision is active.')
  return { project: published.project, revisionId: published.revisionId }
}

function requireEntity(project: WorkcellProjectV5, id: string) {
  const entity = project.spatialEntities.find((candidate) => candidate.id === id)
  return entity ?? fail(`Object ${id} does not exist.`)
}

function requireRobot(project: WorkcellProjectV5, id: string) {
  const robot = project.robots.find((candidate) => candidate.id === id)
  return robot ?? fail(`Robot ${id} does not exist.`)
}

function requireGroup(project: WorkcellProjectV5, id: string) {
  const group = project.sceneGroups.find((candidate) => candidate.id === id)
  return group ?? fail(`Group ${id} does not exist.`)
}

function assertFreshId(project: WorkcellProjectV5, id: string): void {
  const allIds = new Set([
    ...project.spatialEntities.map((entity) => entity.id),
    ...project.scene.frames.map((frame) => frame.id),
    ...project.spatialEntities.flatMap((entity) => [...entity.graspFrames, ...entity.movingFrames].map((frame) => frame.frameId)),
  ])
  if (id.length === 0 || allIds.has(id)) fail(`Generated V6 scene ID ${id} is not fresh.`)
}

function reserveFreshId(project: WorkcellProjectV5, reserved: Set<string>, id: string): void {
  assertFreshId(project, id)
  if (reserved.has(id)) fail(`Generated V6 scene ID ${id} is not fresh.`)
  reserved.add(id)
}

function pruneEntityMappings(project: WorkcellProjectV5, entityId: string): WorkcellProjectV5['opcUa'] {
  const mappings = project.opcUa.mappings.flatMap((mapping) => {
    const leaves = mapping.leaves.filter((leaf) => !(
      (leaf.projectTarget.type === 'entity-frame' || leaf.projectTarget.type === 'entity-status')
      && leaf.projectTarget.entityId === entityId
    ))
    return leaves.length === 0 ? [] : [{ ...mapping, leaves }]
  })
  const validMappingIds = new Set(mappings.map((mapping) => mapping.id))
  return {
    ...project.opcUa,
    mappings,
    bridgeRoutes: project.opcUa.bridgeRoutes.filter((route) => (
      validMappingIds.has(route.sourceMappingId) && validMappingIds.has(route.destinationMappingId)
    )),
  }
}

export function createSceneCommandServiceV6(options: SceneCommandServiceV6Options): SceneCommandServiceV6 {
  const mutate = async (revisionId: string, description: string, recipe: (project: WorkcellProjectV5) => WorkcellProjectV5): Promise<void> => {
    await options.mutations.mutate({ expectedRevisionId: revisionId, description, recipe })
  }
  return Object.freeze({
    async rename(selection: SceneMutableSelectionV6, name: string) {
      if (name.trim().length === 0) fail('Scene names must not be empty.')
      const active = activePublication(options.mutations)
      const project = active.project
      if (selection.kind === 'robot') requireRobot(project, selection.id)
      else if (selection.kind === 'entity') requireEntity(project, selection.id)
      else requireGroup(project, selection.id)
      await mutate(active.revisionId, `Rename ${selection.kind}`, (active) => {
        if (selection.kind === 'robot') { requireRobot(active, selection.id); return { ...active, robots: active.robots.map((robot) => robot.id === selection.id ? { ...robot, name } : robot) } }
        if (selection.kind === 'entity') { requireEntity(active, selection.id); return { ...active, spatialEntities: active.spatialEntities.map((entity) => entity.id === selection.id ? { ...entity, name } : entity) } }
        requireGroup(active, selection.id)
        return { ...active, sceneGroups: active.sceneGroups.map((group) => group.id === selection.id ? { ...group, name } : group) }
      })
    },

    async setVisibility(selection: SceneMutableSelectionV6, visible: boolean) {
      const active = activePublication(options.mutations)
      const project = active.project
      if (selection.kind === 'robot') requireRobot(project, selection.id)
      else if (selection.kind === 'entity') requireEntity(project, selection.id)
      else requireGroup(project, selection.id)
      await mutate(active.revisionId, `Set ${selection.kind} visibility`, (active) => {
        if (selection.kind === 'robot') { requireRobot(active, selection.id); return { ...active, robots: active.robots.map((robot) => robot.id === selection.id ? { ...robot, visible } : robot) } }
        if (selection.kind === 'entity') { requireEntity(active, selection.id); return { ...active, spatialEntities: active.spatialEntities.map((entity) => entity.id === selection.id ? { ...entity, visible } : entity) } }
        requireGroup(active, selection.id)
        return { ...active, sceneGroups: active.sceneGroups.map((group) => group.id === selection.id ? { ...group, visible } : group) }
      })
    },

    async duplicateEntity(entityId: string) {
      const active = activePublication(options.mutations)
      const snapshot = requireEntity(active.project, entityId)
      const reservedIds = new Set<string>()
      const createFreshId = (): string => {
        const id = options.createId()
        reserveFreshId(active.project, reservedIds, id)
        return id
      }
      const entityIdCopy = createFreshId()
      const frameIdByOriginal = new Map<string, string>()
      for (const frame of [...snapshot.graspFrames, ...snapshot.movingFrames]) frameIdByOriginal.set(frame.frameId, createFreshId())
      await mutate(active.revisionId, `Duplicate Object ${entityId}`, (active) => {
        const entity = requireEntity(active, entityId)
        assertFreshId(active, entityIdCopy)
        for (const id of frameIdByOriginal.values()) assertFreshId(active, id)
        const remapFrame = (frameId: string) => frameIdByOriginal.get(frameId) ?? frameId
        const clone = {
          ...entity,
          id: entityIdCopy,
          name: `${entity.name} copy`,
          parentFrameId: remapFrame(entity.parentFrameId),
          graspFrames: entity.graspFrames.map((frame) => ({ ...frame, frameId: remapFrame(frame.frameId) })),
          movingFrames: entity.movingFrames.map((frame) => ({ ...frame, frameId: remapFrame(frame.frameId), parentFrameId: remapFrame(frame.parentFrameId) })),
        }
        return { ...active, spatialEntities: [...active.spatialEntities, clone] }
      })
      options.onSelectionChange?.({ kind: 'entity', id: entityIdCopy })
      return entityIdCopy
    },

    async deleteEntity(entityId: string) {
      const active = activePublication(options.mutations)
      const entity = requireEntity(active.project, entityId)
      if (!entity.removable) fail(`Object ${entityId} is not removable.`)
      await mutate(active.revisionId, `Delete Object ${entityId}`, (active) => {
        const current = requireEntity(active, entityId)
        if (!current.removable) fail(`Object ${entityId} is not removable.`)
        return { ...active, spatialEntities: active.spatialEntities.filter((candidate) => candidate.id !== entityId), opcUa: pruneEntityMappings(active, entityId) }
      })
      options.onSelectionChange?.(null)
    },

    async deleteGroup(groupId: string) {
      const active = activePublication(options.mutations)
      const project = active.project
      requireGroup(project, groupId)
      if (project.sceneGroups.some((group) => group.parentGroupId === groupId) || project.spatialEntities.some((entity) => entity.groupId === groupId)) fail(`Group ${groupId} is not empty.`)
      await mutate(active.revisionId, `Delete Group ${groupId}`, (active) => {
        requireGroup(active, groupId)
        if (active.sceneGroups.some((group) => group.parentGroupId === groupId) || active.spatialEntities.some((entity) => entity.groupId === groupId)) fail(`Group ${groupId} is not empty.`)
        return { ...active, sceneGroups: active.sceneGroups.filter((group) => group.id !== groupId) }
      })
      options.onSelectionChange?.(null)
    },
  })
}
