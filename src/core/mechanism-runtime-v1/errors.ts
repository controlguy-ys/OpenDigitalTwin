export type MechanismErrorCodeV1 =
  | 'SOLVER_REGISTRATION_DUPLICATE'
  | 'SOLVER_UNAVAILABLE'
  | 'SOLVER_CAPABILITY_UNAVAILABLE'
  | 'SOLVER_PARAMETERS_INVALID'
  | 'SOLVER_RESULT_INVALID'
  | 'TOPOLOGY_UNSUPPORTED'
  | 'MECHANISM_TOPOLOGY_INVALID'
  | 'MECHANISM_RESOURCE_LIMIT_EXCEEDED'
  | 'MECHANISM_ID_DUPLICATE'
  | 'MECHANISM_VALUE_INVALID'
  | 'BODY_NOT_FOUND'
  | 'FRAME_PARENT_NOT_FOUND'
  | 'FRAME_CYCLE'
  | 'FRAME_NOT_FOUND'
  | 'MOTION_GROUP_NOT_FOUND'
  | 'MOTION_GROUP_INVALID'
  | 'COORDINATE_SET_MISMATCH'
  | 'COORDINATE_VALUE_NOT_FINITE'
  | 'JOINT_LIMIT_INVALID'
  | 'JOINT_LIMIT_EXCEEDED'
  | 'JOINT_DIRECTION_INVALID'
  | 'JOINT_AXIS_NOT_NORMALIZABLE'
  | 'TRANSFORM_INVALID'
  | 'CONSTRAINT_UNSATISFIED'

export class MechanismErrorV1 extends Error {
  readonly code: MechanismErrorCodeV1
  readonly path: string
  readonly recovery?: string
  override readonly cause?: unknown

  constructor(
    code: MechanismErrorCodeV1,
    path: string,
    message: string,
    recovery?: string,
    cause?: unknown,
  ) {
    super(`${code} at ${path}: ${message}`)
    this.name = 'MechanismErrorV1'
    this.code = code
    this.path = path
    if (recovery !== undefined) this.recovery = recovery
    if (cause !== undefined) this.cause = cause
  }
}

export function failMechanismV1(
  code: MechanismErrorCodeV1,
  path: string,
  message: string,
  recovery?: string,
  cause?: unknown,
): never {
  throw new MechanismErrorV1(code, path, message, recovery, cause)
}
