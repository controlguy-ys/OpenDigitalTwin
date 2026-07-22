import type { RigidTransformV5, Vector3V5 } from '../project-v5/rigid-transform.js'
import type { FrameDefinitionV5, RobotLinkDefinitionV5 } from '../project-v5/types.js'

export interface RobotMechanicsDraftJointV1 {
  readonly id: string
  readonly type: 'revolute' | 'prismatic' | 'fixed'
  readonly parentLinkId: string
  readonly childLinkId: string
  readonly origin: RigidTransformV5
  readonly axis: Vector3V5 | null
  readonly min: number | null
  readonly max: number | null
  readonly home: number | null
  readonly zeroOffset: number
  readonly direction: 1 | -1
  readonly maximumVelocity: number | null
}

export interface RobotMechanicsDraftV1 {
  readonly links: readonly RobotLinkDefinitionV5[]
  readonly joints: readonly RobotMechanicsDraftJointV1[]
  readonly frames: readonly FrameDefinitionV5[]
}
