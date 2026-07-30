import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'

export interface SceneTreeRowV6 {
  readonly key: string
  readonly kind: 'section' | 'frame' | 'robot' | 'group' | 'object'
  readonly id: string
  readonly parentKey: string | null
  readonly depth: number
  readonly name: string
  readonly visible: boolean | null
  readonly ownerLabel: string | null
}

function ownerLabel(owner: string): string {
  if (owner === 'manual') return 'Manual'
  if (owner === 'simulation') return 'Simulation'
  return `OPC UA: ${owner.slice('opcua:'.length)}`
}

function section(id: 'frames' | 'robots' | 'groups' | 'objects'): SceneTreeRowV6 {
  return { key: `section:${id}`, kind: 'section', id, parentKey: null, depth: 0, name: id[0]!.toUpperCase() + id.slice(1), visible: null, ownerLabel: null }
}

export function buildSceneTreeRowsV6(project: WorkcellProjectV5): readonly SceneTreeRowV6[] {
  const rows: SceneTreeRowV6[] = []
  const frames = section('frames')
  rows.push(frames)
  const frameIds = new Set(project.scene.frames.map((frame) => frame.id))
  const depthByFrameId = new Map<string, number>()
  const frameDepth = (frameId: string, visited: ReadonlySet<string> = new Set()): number => {
    const cached = depthByFrameId.get(frameId)
    if (cached !== undefined) return cached
    const frame = project.scene.frames.find((candidate) => candidate.id === frameId)
    if (frame === undefined || frame.parentFrameId === null || !frameIds.has(frame.parentFrameId) || visited.has(frameId)) return 1
    const depth = frameDepth(frame.parentFrameId, new Set([...visited, frameId])) + 1
    depthByFrameId.set(frameId, depth)
    return depth
  }
  rows.push(...project.scene.frames.map((frame) => ({
    key: `frame:${frame.id}`, kind: 'frame' as const, id: frame.id,
    parentKey: frame.parentFrameId !== null && frameIds.has(frame.parentFrameId) ? `frame:${frame.parentFrameId}` : frames.key,
    depth: frameDepth(frame.id), name: frame.name, visible: null, ownerLabel: frame.role,
  })))

  const robots = section('robots')
  rows.push(robots)
  rows.push(...project.robots.map((robot) => ({
    key: `robot:${robot.id}`, kind: 'robot' as const, id: robot.id, parentKey: robots.key,
    depth: 1, name: robot.name, visible: robot.visible, ownerLabel: ownerLabel(robot.jointSource),
  })))

  const groups = section('groups')
  rows.push(groups)
  const descendants = new Map<string | null, typeof project.sceneGroups>()
  for (const group of project.sceneGroups) descendants.set(group.parentGroupId, [...(descendants.get(group.parentGroupId) ?? []), group])
  const objectsByGroup = new Map<string, typeof project.spatialEntities>()
  for (const entity of project.spatialEntities) {
    if (entity.groupId !== null) objectsByGroup.set(entity.groupId, [...(objectsByGroup.get(entity.groupId) ?? []), entity])
  }
  const addGroup = (group: WorkcellProjectV5['sceneGroups'][number], parentKey: string, depth: number): void => {
    const key = `group:${group.id}`
    rows.push({ key, kind: 'group', id: group.id, parentKey, depth, name: group.name, visible: group.visible, ownerLabel: null })
    for (const entity of objectsByGroup.get(group.id) ?? []) {
      rows.push({ key: `object:${entity.id}`, kind: 'object', id: entity.id, parentKey: key, depth: depth + 1, name: entity.name, visible: entity.visible, ownerLabel: ownerLabel(entity.transformOwner) })
    }
    for (const child of descendants.get(group.id) ?? []) addGroup(child, key, depth + 1)
  }
  for (const group of descendants.get(null) ?? []) addGroup(group, groups.key, 1)

  const objects = section('objects')
  rows.push(objects)
  for (const entity of project.spatialEntities) {
    if (entity.groupId !== null) continue
    rows.push({ key: `object:${entity.id}`, kind: 'object', id: entity.id, parentKey: objects.key, depth: 1, name: entity.name, visible: entity.visible, ownerLabel: ownerLabel(entity.transformOwner) })
  }
  return rows
}

export function filterSceneTreeRowsV6(rows: readonly SceneTreeRowV6[], query: string): readonly SceneTreeRowV6[] {
  const normalized = query.trim().toLocaleLowerCase()
  if (normalized.length === 0) return rows
  const parents = new Map(rows.map((row) => [row.key, row.parentKey]))
  const keep = new Set<string>()
  for (const row of rows) {
    if (!`${row.name} ${row.ownerLabel ?? ''}`.toLocaleLowerCase().includes(normalized)) continue
    let key: string | null = row.key
    while (key !== null) { keep.add(key); key = parents.get(key) ?? null }
  }
  return rows.filter((row) => keep.has(row.key))
}

export function hasSceneTreeChildrenV6(rows: readonly SceneTreeRowV6[], key: string): boolean {
  return rows.some((row) => row.parentKey === key)
}
