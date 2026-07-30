import { normalizeRigidTransformV5 } from '../../../core/project-v5/rigid-transform.js'

export type TransformOwnerV6 = 'manual' | 'simulation' | 'attachment' | `opcua:${string}`

export interface TransformPoseV6 {
  readonly positionM: readonly [number, number, number]
  readonly quaternion: readonly [number, number, number, number]
}

export interface TransformSessionV6Options {
  readonly owner: TransformOwnerV6
  readonly initialPose: TransformPoseV6
  readonly readCurrentPose?: () => TransformPoseV6
  readonly applyDraft: (pose: TransformPoseV6) => void
  readonly restore?: (pose: TransformPoseV6) => void
  readonly mutate: (pose: TransformPoseV6) => Promise<void>
}

export interface TransformSessionV6 {
  begin(): { readonly accepted: true } | { readonly accepted: false; readonly reason: string }
  update(pose: TransformPoseV6): void
  cancel(): void
  commit(): Promise<void>
}

function copyPose(pose: TransformPoseV6): TransformPoseV6 {
  const normalized = normalizeRigidTransformV5(pose, '$.transform')
  return Object.freeze({
    positionM: Object.freeze([...normalized.positionM] as [number, number, number]),
    quaternion: Object.freeze([...normalized.quaternion] as [number, number, number, number]),
  })
}

function ownerExplanation(owner: TransformOwnerV6): string {
  return `Transform is owned by ${owner}; release that owner before editing.`
}

export function createTransformSessionV6(options: TransformSessionV6Options): TransformSessionV6 {
  let active = false
  let draft: TransformPoseV6 | null = null
  let snapshot: TransformPoseV6 | null = null
  const allowed = options.owner === 'manual'
  const restore = (value: TransformPoseV6) => options.restore?.(value)
  return Object.freeze({
    begin() {
      if (!allowed) return { accepted: false as const, reason: ownerExplanation(options.owner) }
      try {
        snapshot = copyPose(options.readCurrentPose?.() ?? options.initialPose)
      } catch {
        return { accepted: false as const, reason: 'Transform pose is invalid and cannot be edited.' }
      }
      active = true
      draft = null
      return { accepted: true as const }
    },
    update(pose: TransformPoseV6) {
      if (!active || !allowed) return
      try {
        draft = copyPose(pose)
      } catch {
        return
      }
      options.applyDraft(draft)
    },
    cancel() {
      if (!active || snapshot === null) return
      active = false
      draft = null
      restore(snapshot)
      snapshot = null
    },
    async commit() {
      if (!active || !allowed || draft === null || snapshot === null) return
      const published = draft
      const snapshotAtDragStart = snapshot
      active = false
      draft = null
      snapshot = null
      try {
        await options.mutate(published)
      } catch (error) {
        restore(snapshotAtDragStart)
        throw error
      }
    },
  })
}
