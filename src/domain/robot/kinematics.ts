import { Group, MathUtils, Vector3 } from 'three'
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
  readonly toolFrame: Group
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
  const toolFrame = new Group()
  toolFrame.name = 'tool-frame'
  toolFrame.rotation.set(0, definition.toolRotationYRad, 0)
  finalLinkSlot.add(toolFrame)

  return {
    definition,
    root,
    baseSlot,
    jointPivots,
    linkSlots: linkSlots as Record<RobotLinkId, Group>,
    toolFrame,
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
