import { useEffect, useState, type ReactNode } from 'react'

import type { WorkcellProjectV5 } from '../../../core/project-v5/index.js'
import type { SceneCommandServiceV6 } from '../../scene/v6/scene-command-service-v6.js'

export interface GroupInspectorV6Props {
  readonly project: WorkcellProjectV5
  readonly groupId: string
  readonly sceneCommands?: Pick<SceneCommandServiceV6, 'updateGroup'>
}

function effectiveVisibility(project: WorkcellProjectV5, groupId: string): boolean {
  const groups = new Map(project.sceneGroups.map((group) => [group.id, group]))
  const visited = new Set<string>()
  let current = groups.get(groupId)
  let visible = true
  while (current !== undefined && !visited.has(current.id)) {
    visited.add(current.id)
    visible = visible && current.visible
    current = current.parentGroupId === null ? undefined : groups.get(current.parentGroupId)
  }
  return visible
}

function isDescendant(project: WorkcellProjectV5, candidateId: string, ancestorId: string): boolean {
  const groups = new Map(project.sceneGroups.map((group) => [group.id, group]))
  const visited = new Set<string>()
  let current = groups.get(candidateId)
  while (current !== undefined && !visited.has(current.id)) {
    if (current.id === ancestorId) return true
    visited.add(current.id)
    current = current.parentGroupId === null ? undefined : groups.get(current.parentGroupId)
  }
  return false
}

export function GroupInspectorV6({ project, groupId, sceneCommands }: GroupInspectorV6Props): ReactNode {
  const group = project.sceneGroups.find((candidate) => candidate.id === groupId)
  const parent = group?.parentGroupId === null || group?.parentGroupId === undefined
    ? null
    : project.sceneGroups.find((candidate) => candidate.id === group.parentGroupId) ?? null
  const [name, setName] = useState(group?.name ?? '')
  const [parentGroupId, setParentGroupId] = useState<string | null>(group?.parentGroupId ?? null)
  const [visible, setVisible] = useState(group?.visible ?? false)
  const [pending, setPending] = useState(false)
  const [error, setError] = useState<string | null>(null)

  useEffect(() => {
    setName(group?.name ?? '')
    setParentGroupId(group?.parentGroupId ?? null)
    setVisible(group?.visible ?? false)
    setError(null)
  }, [group?.name, group?.parentGroupId, group?.visible, groupId, project.revisionId])

  if (group === undefined) {
    return <section className="v6-selection-inspector" aria-live="polite"><p>Selected Group is no longer available.</p></section>
  }

  const apply = (): void => {
    if (sceneCommands === undefined || name.trim().length === 0 || pending) return
    setPending(true)
    setError(null)
    void sceneCommands.updateGroup(groupId, { name, parentGroupId, visible }).catch((caught: unknown) => {
      setError(caught instanceof Error ? caught.message : String(caught))
    }).finally(() => setPending(false))
  }

  return <section aria-label={`${group.name} Group inspector`} className="v6-selection-inspector">
    <header><h2>{group.name}</h2><p>Group inspection and persisted visibility.</p></header>
    <details className="v6-inspector-section" open>
      <summary aria-label="Group section">Group</summary>
      <div className="v6-inspector-section-body">
        <dl>
          <div><dt>Parent Group</dt><dd>Parent Group: {parent?.name ?? 'None'}</dd></div>
          <div><dt>Effective visibility</dt><dd>Effective visibility: {effectiveVisibility(project, groupId) ? 'Visible' : 'Hidden'}</dd></div>
          <div><dt>Persisted visibility</dt><dd>Persisted visibility: {group.visible ? 'Visible' : 'Hidden'}</dd></div>
        </dl>
        <label>Group Name<input aria-label="Group Name" disabled={pending || sceneCommands === undefined} onChange={(event) => setName(event.currentTarget.value)} value={name} /></label>
        <label>Parent Group<select aria-label="Parent Group" disabled={pending || sceneCommands === undefined} onChange={(event) => setParentGroupId(event.currentTarget.value.length === 0 ? null : event.currentTarget.value)} value={parentGroupId ?? ''}>
          <option value="">None</option>
          {project.sceneGroups.filter((candidate) => candidate.id !== groupId && !isDescendant(project, candidate.id, groupId)).map((candidate) => <option key={candidate.id} value={candidate.id}>{candidate.name}</option>)}
        </select></label>
        <label className="v6-switch-field"><input aria-label="Group Visible" checked={visible} disabled={pending || sceneCommands === undefined} onChange={(event) => setVisible(event.currentTarget.checked)} type="checkbox" /><span>Group Visible</span></label>
        <div className="v6-inspector-actions"><button disabled={pending || sceneCommands === undefined || name.trim().length === 0} onClick={apply} type="button">Apply Group</button><button disabled={pending} onClick={() => { setName(group.name); setParentGroupId(group.parentGroupId); setVisible(group.visible); setError(null) }} type="button">Reset Group</button></div>
        {error === null ? null : <p role="alert">{error}</p>}
      </div>
    </details>
  </section>
}
