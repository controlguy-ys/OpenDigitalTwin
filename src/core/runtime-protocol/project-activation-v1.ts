import {
  validateWorkcellProjectV5,
  type WorkcellProjectV5,
} from '../project-v5/index.js'

const CONFIG_REVISION = /^[0-9a-f]{64}$/u
const ATTEMPT = /^[A-Za-z0-9_-]{8,128}$/u

export interface RuntimeProjectAuthorityV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly configRevision: string
  readonly activationAttemptId: string
}

export interface RuntimeProjectActivationRequestV1 {
  readonly type: 'runtime-project-activation-v1'
  readonly protocolVersion: 1
  readonly project: WorkcellProjectV5
  readonly configRevision: string
  readonly activationAttemptId: string
  readonly expectedAuthority: RuntimeProjectAuthorityV1 | null
}

export function isRuntimeProjectAuthorityV1(
  value: unknown,
): value is RuntimeProjectAuthorityV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) return false
  const source = value as Record<string, unknown>
  const keys = Object.keys(source).sort()
  if (keys.length !== 4 || keys.some((key, index) => key !== ['activationAttemptId', 'configRevision', 'projectId', 'revisionId'][index])) return false
  return typeof source.projectId === 'string' && source.projectId.length > 0
    && typeof source.revisionId === 'string' && source.revisionId.length > 0
    && typeof source.configRevision === 'string' && CONFIG_REVISION.test(source.configRevision)
    && typeof source.activationAttemptId === 'string' && ATTEMPT.test(source.activationAttemptId)
}

export function runtimeProjectAuthorityEqualsV1(
  left: RuntimeProjectAuthorityV1 | null,
  right: RuntimeProjectAuthorityV1 | null,
): boolean {
  return left === right || (left !== null && right !== null
    && left.projectId === right.projectId
    && left.revisionId === right.revisionId
    && left.configRevision === right.configRevision
    && left.activationAttemptId === right.activationAttemptId)
}

export function validateRuntimeProjectActivationRequestV1(
  value: unknown,
): RuntimeProjectActivationRequestV1 {
  if (value === null || typeof value !== 'object' || Array.isArray(value)) throw new Error('RUNTIME_PROJECT_ACTIVATION_INVALID')
  const source = value as Record<string, unknown>
  const actual = Object.keys(source).sort()
  const expected = ['activationAttemptId', 'configRevision', 'expectedAuthority', 'project', 'protocolVersion', 'type']
  if (actual.length !== expected.length || actual.some((key, index) => key !== expected[index])) throw new Error('RUNTIME_PROJECT_ACTIVATION_INVALID')
  if (source.type !== 'runtime-project-activation-v1' || source.protocolVersion !== 1 || typeof source.configRevision !== 'string' || !CONFIG_REVISION.test(source.configRevision) || typeof source.activationAttemptId !== 'string' || !ATTEMPT.test(source.activationAttemptId)) throw new Error('RUNTIME_PROJECT_ACTIVATION_INVALID')
  const expectedAuthority = source.expectedAuthority === null ? null : isRuntimeProjectAuthorityV1(source.expectedAuthority) ? source.expectedAuthority : null
  if (source.expectedAuthority !== null && expectedAuthority === null) throw new Error('RUNTIME_PROJECT_ACTIVATION_INVALID')
  try {
    return Object.freeze({
      type: 'runtime-project-activation-v1', protocolVersion: 1,
      project: validateWorkcellProjectV5(source.project),
      configRevision: source.configRevision, activationAttemptId: source.activationAttemptId,
      expectedAuthority: expectedAuthority === null ? null : Object.freeze({ ...expectedAuthority }),
    })
  } catch { throw new Error('RUNTIME_PROJECT_ACTIVATION_INVALID') }
}
