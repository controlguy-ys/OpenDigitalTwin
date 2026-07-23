export const PRODUCT_COMMAND_STAGING_TIMEOUT_MS_V1 = 60_000

export type ProductCommandPayloadV1 =
  | { readonly kind: 'robot-joint-target'; readonly robotId: string; readonly jointValues: Readonly<Record<string, number>> }
  | { readonly kind: 'scene-object-pose'; readonly objectId: string; readonly pose: Readonly<{ x: number; y: number; z: number; roll: number; pitch: number; yaw: number }> }
  | { readonly kind: 'logical-signal'; readonly signalId: string; readonly value: boolean | number | string }
  | { readonly kind: 'job'; readonly jobId: string; readonly operation: 'start' | 'cancel' }

export interface ProductCommandSnapshotV1 {
  readonly requestId: string
  readonly expiresAt: number
  readonly projectId: string
  readonly revisionId: string
  readonly configRevision: string
  readonly sessionId: string
  readonly targetId: string
  readonly payload: ProductCommandPayloadV1
}

export type ProductCommandTargetV1 = Readonly<{
  targetId: string
  projectId: string
  revisionId: string
  configRevision: string
  payload:
    | { readonly kind: 'robot-joint-target'; readonly robotId: string; readonly jointIds: readonly string[] }
    | { readonly kind: 'scene-object-pose'; readonly objectId: string }
    | { readonly kind: 'logical-signal'; readonly signalId: string }
    | { readonly kind: 'job'; readonly jobId: string }
}>

export type ProductCommandFieldV1 = 'RequestId' | 'ExpiresAt' | 'Execute' | 'X' | 'Y' | 'Z' | 'Roll' | 'Pitch' | 'Yaw' | 'Value' | 'Operation' | string

export interface ProductCommandStagingV1 {
  write(sessionId: string, target: ProductCommandTargetV1, field: ProductCommandFieldV1, value: unknown, nowMs: number): ProductCommandSnapshotV1 | null
  closeSession(sessionId: string): void
  /** Removes stages whose latest field write is at least sixty seconds old. */
  sweep(nowMs: number): number
  clear(): void
  size(): number
}

export class ProductCommandStagingErrorV1 extends Error {
  readonly code: 'COMMAND_STAGE_INCOMPLETE' | 'COMMAND_EXPIRED' | 'COMMAND_EXPIRY_INVALID' | 'COMMAND_STAGE_INVALID'

  constructor(code: ProductCommandStagingErrorV1['code']) {
    super(code)
    this.name = 'ProductCommandStagingErrorV1'
    this.code = code
  }
}

interface StageV1 {
  readonly values: Map<string, unknown>
  execute: boolean
  updatedAtMs: number
}

function requireText(value: unknown): string {
  if (typeof value !== 'string' || value.length === 0) throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INVALID')
  return value
}

function requireFinite(value: unknown): number {
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INVALID')
  return value
}

function epochMilliseconds(value: unknown): number {
  if (value instanceof Date) {
    const milliseconds = value.valueOf()
    if (!Number.isSafeInteger(milliseconds) || milliseconds < 0) throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INVALID')
    return milliseconds
  }
  if (!Number.isSafeInteger(value) || (value as number) < 0) throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INVALID')
  return value as number
}

function completeSnapshot(
  target: ProductCommandTargetV1,
  sessionId: string,
  stage: StageV1,
  nowMs: number,
): ProductCommandSnapshotV1 {
  const requestId = requireText(stage.values.get('RequestId'))
  const expiresAt = epochMilliseconds(stage.values.get('ExpiresAt'))
  if (expiresAt <= nowMs) throw new ProductCommandStagingErrorV1('COMMAND_EXPIRED')
  if (expiresAt > nowMs + PRODUCT_COMMAND_STAGING_TIMEOUT_MS_V1) {
    throw new ProductCommandStagingErrorV1('COMMAND_EXPIRY_INVALID')
  }

  let payload: ProductCommandPayloadV1
  if (target.payload.kind === 'robot-joint-target') {
    const jointValues = Object.create(null) as Record<string, number>
    for (const jointId of target.payload.jointIds) jointValues[jointId] = requireFinite(stage.values.get(jointId))
    payload = Object.freeze({ kind: 'robot-joint-target', robotId: target.payload.robotId, jointValues: Object.freeze(jointValues) })
  } else if (target.payload.kind === 'scene-object-pose') {
    payload = Object.freeze({
      kind: 'scene-object-pose', objectId: target.payload.objectId,
      pose: Object.freeze({
        x: requireFinite(stage.values.get('X')), y: requireFinite(stage.values.get('Y')), z: requireFinite(stage.values.get('Z')),
        roll: requireFinite(stage.values.get('Roll')), pitch: requireFinite(stage.values.get('Pitch')), yaw: requireFinite(stage.values.get('Yaw')),
      }),
    })
  } else if (target.payload.kind === 'logical-signal') {
    const value = stage.values.get('Value')
    if (typeof value !== 'boolean' && typeof value !== 'number' && typeof value !== 'string') {
      throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INCOMPLETE')
    }
    payload = Object.freeze({ kind: 'logical-signal', signalId: target.payload.signalId, value })
  } else {
    const operation = stage.values.get('Operation')
    if (operation !== 'start' && operation !== 'cancel') throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INCOMPLETE')
    payload = Object.freeze({ kind: 'job', jobId: target.payload.jobId, operation })
  }
  return Object.freeze({ requestId, expiresAt, projectId: target.projectId, revisionId: target.revisionId, configRevision: target.configRevision, sessionId, targetId: target.targetId, payload })
}

export function createProductCommandStagingV1(): ProductCommandStagingV1 {
  const stagesBySession = new Map<string, Map<string, StageV1>>()
  const executeLevelsBySession = new Map<string, Map<string, boolean>>()

  function stageFor(sessionId: string, targetId: string, nowMs: number): StageV1 {
    const byTarget = stagesBySession.get(sessionId) ?? new Map<string, StageV1>()
    stagesBySession.set(sessionId, byTarget)
    const previous = byTarget.get(targetId)
    if (previous !== undefined && nowMs - previous.updatedAtMs >= PRODUCT_COMMAND_STAGING_TIMEOUT_MS_V1) byTarget.delete(targetId)
    const existing = byTarget.get(targetId)
    if (existing !== undefined) return existing
    const created: StageV1 = { values: new Map(), execute: false, updatedAtMs: nowMs }
    byTarget.set(targetId, created)
    return created
  }

  return Object.freeze({
    write(sessionId: string, target: ProductCommandTargetV1, field: ProductCommandFieldV1, value: unknown, nowMs: number) {
      if (typeof sessionId !== 'string' || sessionId.length === 0 || !Number.isSafeInteger(nowMs) || nowMs < 0) {
        throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INVALID')
      }
      const stage = stageFor(sessionId, target.targetId, nowMs)
      stage.updatedAtMs = nowMs
      if (field !== 'Execute') {
        stage.values.set(field, value)
        return null
      }
      if (typeof value !== 'boolean') throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INVALID')
      const levels = executeLevelsBySession.get(sessionId) ?? new Map<string, boolean>()
      executeLevelsBySession.set(sessionId, levels)
      const wasHigh = levels.get(target.targetId) ?? false
      if (!value) {
        stage.execute = false
        levels.set(target.targetId, false)
        return null
      }
      if (wasHigh) return null
      let snapshot: ProductCommandSnapshotV1
      try {
        snapshot = completeSnapshot(target, sessionId, stage, nowMs)
      } catch (error) {
        if (error instanceof ProductCommandStagingErrorV1 && error.code === 'COMMAND_STAGE_INVALID') {
          throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INCOMPLETE')
        }
        throw error
      }
      stage.execute = true
      levels.set(target.targetId, true)
      const byTarget = stagesBySession.get(sessionId)!
      byTarget.delete(target.targetId)
      if (byTarget.size === 0) stagesBySession.delete(sessionId)
      return snapshot
    },
    closeSession(sessionId: string) { stagesBySession.delete(sessionId); executeLevelsBySession.delete(sessionId) },
    sweep(nowMs: number) {
      if (!Number.isSafeInteger(nowMs) || nowMs < 0) throw new ProductCommandStagingErrorV1('COMMAND_STAGE_INVALID')
      let removed = 0
      for (const [sessionId, targets] of stagesBySession) {
        const levels = executeLevelsBySession.get(sessionId)
        for (const [targetId, stage] of targets) {
          if (nowMs - stage.updatedAtMs < PRODUCT_COMMAND_STAGING_TIMEOUT_MS_V1) continue
          targets.delete(targetId)
          levels?.delete(targetId)
          removed += 1
        }
        if (targets.size === 0) stagesBySession.delete(sessionId)
        if (levels?.size === 0) executeLevelsBySession.delete(sessionId)
      }
      return removed
    },
    clear() { stagesBySession.clear(); executeLevelsBySession.clear() },
    size() { return [...stagesBySession.values()].reduce((count, targets) => count + targets.size, 0) },
  })
}
