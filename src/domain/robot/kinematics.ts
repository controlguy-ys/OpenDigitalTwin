import { Group, MathUtils, Vector3 } from 'three'
import type { SerializableTransform } from '../equipment/equipment'
import type { RobotJointDefinition, RobotLinkId } from './crb15000'
import {
  clampJointAngles,
  type JointAnglesDeg,
  type RobotLimitDefinition,
} from './joint-frame'

type RobotJointId = RobotJointDefinition['id']
type RobotKinematicJointDefinition = Omit<
  RobotJointDefinition,
  'parentLink' | 'childLink'
> & {
  readonly parentLink: RobotLinkId
  readonly childLink: RobotLinkId
}

export interface RobotKinematicDefinition extends RobotLimitDefinition {
  readonly id: string
  readonly baseLink: RobotLinkId
  readonly joints: readonly RobotKinematicJointDefinition[]
  readonly toolRotationYRad: number
}

export interface RobotRig {
  readonly definition: RobotKinematicDefinition
  readonly root: Group
  readonly baseSlot: Group
  readonly jointPivots: Record<RobotJointId, Group>
  readonly linkSlots: Record<RobotLinkId, Group>
  readonly flangeFrame: Group
  readonly toolFrame: Group
  readonly tcpFrame: Group
}

export type RobotGeometryTransforms = Readonly<
  Record<RobotLinkId, SerializableTransform>
>

export interface RobotToolFrameTransforms {
  readonly flange: SerializableTransform
  readonly tool: SerializableTransform
  readonly tcp: SerializableTransform
}

export interface RobotWorldMatrices {
  readonly linkSlots: Readonly<Record<RobotLinkId, readonly number[]>>
  readonly linkGeometry: Readonly<Record<RobotLinkId, readonly number[]>>
  readonly flange: readonly number[]
  readonly tool: readonly number[]
  readonly tcp: readonly number[]
}

const JOINT_COUNT = 6

export function createRobotRig(
  definition: RobotKinematicDefinition,
): RobotRig {
  if (definition.joints.length !== JOINT_COUNT) {
    throw new Error('Robot definition must contain exactly six joints')
  }

  const root = new Group()
  root.name = `${definition.id}-rig`

  const baseSlot = new Group()
  baseSlot.name = `${definition.baseLink}-slot`
  root.add(baseSlot)

  const linkSlots: Partial<Record<RobotLinkId, Group>> = {
    [definition.baseLink]: baseSlot,
  }
  const jointPivots = {} as Record<RobotJointId, Group>

  for (const joint of definition.joints) {
    const parentSlot = linkSlots[joint.parentLink]
    if (parentSlot === undefined) {
      throw new Error(`Missing parent link slot: ${joint.parentLink}`)
    }

    const pivot = new Group()
    pivot.name = `${joint.id}-pivot`
    pivot.position.set(...joint.origin)
    parentSlot.add(pivot)
    jointPivots[joint.id] = pivot

    const childSlot = new Group()
    childSlot.name = `${joint.childLink}-slot`
    pivot.add(childSlot)
    linkSlots[joint.childLink] = childSlot
  }

  const finalJoint = definition.joints[JOINT_COUNT - 1]!
  const finalLinkSlot = linkSlots[finalJoint.childLink]
  if (finalLinkSlot === undefined) {
    throw new Error(`Missing final link slot: ${finalJoint.childLink}`)
  }
  const flangeFrame = new Group()
  flangeFrame.name = 'flange-frame'
  finalLinkSlot.add(flangeFrame)

  const toolFrame = new Group()
  toolFrame.name = 'tool-frame'
  toolFrame.rotation.set(0, definition.toolRotationYRad, 0)
  flangeFrame.add(toolFrame)

  const tcpFrame = new Group()
  tcpFrame.name = 'tcp-frame'
  toolFrame.add(tcpFrame)

  return {
    definition,
    root,
    baseSlot,
    jointPivots,
    linkSlots: linkSlots as Record<RobotLinkId, Group>,
    flangeFrame,
    toolFrame,
    tcpFrame,
  }
}

export function setRigAngles(rig: RobotRig, anglesDeg: JointAnglesDeg): void {
  const clampedAngles = clampJointAngles(anglesDeg, rig.definition)

  for (const [index, joint] of rig.definition.joints.entries()) {
    const axis = new Vector3(...joint.axis).normalize()
    const angleRad = MathUtils.degToRad(clampedAngles[index]!)
    rig.jointPivots[joint.id].quaternion.setFromAxisAngle(axis, angleRad)
  }
}

function finiteTransform(
  transform: SerializableTransform,
  label: string,
): SerializableTransform {
  if (
    transform.position.length !== 3 ||
    transform.position.some((value) => !Number.isFinite(value)) ||
    transform.quaternion.length !== 4 ||
    transform.quaternion.some((value) => !Number.isFinite(value)) ||
    transform.scale.length !== 3 ||
    transform.scale.some((value) => !Number.isFinite(value) || value <= 0)
  ) {
    throw new Error(`${label} must contain a finite transform with positive scale`)
  }
  const quaternionLength = Math.hypot(...transform.quaternion)
  if (quaternionLength <= 1e-12) {
    throw new Error(`${label} quaternion must be non-zero`)
  }
  return {
    position: [...transform.position],
    quaternion: transform.quaternion.map(
      (component) => component / quaternionLength,
    ) as SerializableTransform['quaternion'],
    scale: [...transform.scale],
  }
}

export function serializableTransformToMatrixElements(
  candidate: SerializableTransform,
  label: string,
): number[] {
  const transform = finiteTransform(candidate, label)
  const [x, y, z, w] = transform.quaternion
  const x2 = x + x
  const y2 = y + y
  const z2 = z + z
  const xx = x * x2
  const xy = x * y2
  const xz = x * z2
  const yy = y * y2
  const yz = y * z2
  const zz = z * z2
  const wx = w * x2
  const wy = w * y2
  const wz = w * z2
  const [sx, sy, sz] = transform.scale
  return [
    (1 - (yy + zz)) * sx,
    (xy + wz) * sx,
    (xz - wy) * sx,
    0,
    (xy - wz) * sy,
    (1 - (xx + zz)) * sy,
    (yz + wx) * sy,
    0,
    (xz + wy) * sz,
    (yz - wx) * sz,
    (1 - (xx + yy)) * sz,
    0,
    transform.position[0],
    transform.position[1],
    transform.position[2],
    1,
  ]
}

export function multiplyMatrixElements(
  first: readonly number[],
  second: readonly number[],
): number[] {
  if (first.length !== 16 || second.length !== 16) {
    throw new Error('Robot matrix multiplication requires two 4x4 matrices')
  }
  const result = Array.from({ length: 16 }, () => 0)
  for (let column = 0; column < 4; column += 1) {
    for (let row = 0; row < 4; row += 1) {
      let value = 0
      for (let index = 0; index < 4; index += 1) {
        value += first[index * 4 + row]! * second[column * 4 + index]!
      }
      result[column * 4 + row] = value
    }
  }
  return result
}

function jointTransform(
  origin: readonly [number, number, number],
  axis: readonly [number, number, number],
  angleDeg: number,
): SerializableTransform {
  const axisLength = Math.hypot(...axis)
  if (!Number.isFinite(axisLength) || axisLength <= 1e-12) {
    throw new Error('Robot Joint axis must be finite and non-zero')
  }
  const halfAngle = MathUtils.degToRad(angleDeg) / 2
  const sine = Math.sin(halfAngle) / axisLength
  return {
    position: [...origin],
    quaternion: [
      axis[0] * sine,
      axis[1] * sine,
      axis[2] * sine,
      Math.cos(halfAngle),
    ],
    scale: [1, 1, 1],
  }
}

function frozenMatrix(matrix: readonly number[]): readonly number[] {
  return Object.freeze([...matrix])
}

/**
 * Reproduces the rendered Robot hierarchy with serializable inputs only.
 * It allocates no Three.js Object3D instances and returns column-major matrices.
 */
export function computeRobotWorldMatrices(
  definition: RobotKinematicDefinition,
  geometryTransforms: RobotGeometryTransforms,
  toolFrames: RobotToolFrameTransforms,
  anglesDeg: JointAnglesDeg,
  rootPose: SerializableTransform,
): RobotWorldMatrices {
  if (definition.joints.length !== JOINT_COUNT) {
    throw new Error('Robot definition must contain exactly six joints')
  }
  const clampedAngles = clampJointAngles(anglesDeg, definition)
  const slotMatrices: Partial<Record<RobotLinkId, number[]>> = {
    [definition.baseLink]: serializableTransformToMatrixElements(rootPose, 'Robot root pose'),
  }

  for (const [index, joint] of definition.joints.entries()) {
    const parentMatrix = slotMatrices[joint.parentLink]
    if (parentMatrix === undefined) {
      throw new Error(`Missing parent link matrix: ${joint.parentLink}`)
    }
    slotMatrices[joint.childLink] = multiplyMatrixElements(
      parentMatrix,
      serializableTransformToMatrixElements(
        jointTransform(joint.origin, joint.axis, clampedAngles[index]!),
        `${joint.id} transform`,
      ),
    )
  }

  const linkSlots = {} as Record<RobotLinkId, readonly number[]>
  const linkGeometry = {} as Record<RobotLinkId, readonly number[]>
  const requiredLinkIds = [
    definition.baseLink,
    ...definition.joints.map(({ childLink }) => childLink),
  ]
  if (new Set(requiredLinkIds).size !== JOINT_COUNT + 1) {
    throw new Error('Robot definition must resolve exactly seven unique Link slots')
  }
  for (const linkId of requiredLinkIds) {
    const slotMatrix = slotMatrices[linkId]
    const geometryTransform = geometryTransforms[linkId]
    if (slotMatrix === undefined || geometryTransform === undefined) {
      throw new Error(`Missing Robot Link transform: ${linkId}`)
    }
    linkSlots[linkId] = frozenMatrix(slotMatrix)
    linkGeometry[linkId] = frozenMatrix(
      multiplyMatrixElements(
        slotMatrix,
        serializableTransformToMatrixElements(
          geometryTransform,
          `${linkId} geometry transform`,
        ),
      ),
    )
  }

  const finalLink = definition.joints.at(-1)!.childLink
  const finalSlot = slotMatrices[finalLink]!
  const flange = multiplyMatrixElements(
    finalSlot,
    serializableTransformToMatrixElements(toolFrames.flange, 'Robot flange frame'),
  )
  const tool = multiplyMatrixElements(
    flange,
    serializableTransformToMatrixElements(toolFrames.tool, 'Robot Tool frame'),
  )
  const tcp = multiplyMatrixElements(
    tool,
    serializableTransformToMatrixElements(toolFrames.tcp, 'Robot TCP frame'),
  )

  return Object.freeze({
    linkSlots: Object.freeze(linkSlots),
    linkGeometry: Object.freeze(linkGeometry),
    flange: frozenMatrix(flange),
    tool: frozenMatrix(tool),
    tcp: frozenMatrix(tcp),
  })
}
