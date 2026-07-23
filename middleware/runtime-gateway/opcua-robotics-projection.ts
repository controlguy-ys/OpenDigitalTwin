import {
  validateWorkcellProjectV5,
  type RobotControllerV5,
  type RobotDefinitionV5,
  type RobotIdentificationV1,
  type RobotJointDefinitionV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'

export interface RoboticsAxisProjectionV1 {
  readonly jointId: string
  readonly browseName: string
  readonly kind: 'revolute' | 'prismatic'
  readonly actualPosition: number
  readonly minimum: number
  readonly maximum: number
  readonly engineeringUnit: 'degree' | 'millimetre'
}

export interface RoboticsPowerTrainProjectionV1 {
  readonly id: string
  readonly browseName: string
  readonly axisId: string
}

export interface RoboticsMotionDeviceProjectionV1 {
  readonly id: string
  readonly browseName: string
  readonly manufacturer: string
  readonly model: string
  readonly productCode: string
  readonly serialNumber: string
  readonly category: RobotIdentificationV1['motionDeviceCategory']
  readonly controllerId: string
  readonly axes: readonly RoboticsAxisProjectionV1[]
  readonly powerTrains: readonly RoboticsPowerTrainProjectionV1[]
}

export interface RoboticsSafetyProjectionV1 {
  /** No safety source exists in WorkcellProjectV5; this must never be treated as a safety-rated state. */
  readonly value: 'unavailable'
  readonly informationalOnly: true
}

export interface RoboticsSystemProjectionV1 {
  readonly projectId: string
  readonly revisionId: string
  readonly motionDevices: readonly RoboticsMotionDeviceProjectionV1[]
  readonly controllers: readonly RobotControllerV5[]
  readonly safety: RoboticsSafetyProjectionV1
}

type JointEngineeringValueV1 = Readonly<{
  value: number
  unit: RoboticsAxisProjectionV1['engineeringUnit']
}>

type JointEngineeringRangeV1 = Readonly<{
  low: number
  high: number
}>

const OPC_UA_ROBOTICS_PROJECTION_VALUE_INVALID = 'OPC_UA_ROBOTICS_PROJECTION_VALUE_INVALID'

class RoboticsProjectionValueError extends Error {
  readonly code = OPC_UA_ROBOTICS_PROJECTION_VALUE_INVALID

  constructor(name: string) {
    super(`${OPC_UA_ROBOTICS_PROJECTION_VALUE_INVALID}: ${name} must be finite.`)
    this.name = 'RoboticsProjectionValueError'
  }
}

function finiteValue(value: number, name: string): number {
  if (!Number.isFinite(value)) throw new RoboticsProjectionValueError(name)
  return value
}

function millimetres(value: number, name: string): number {
  return finiteValue(finiteValue(value, name) * 1_000, `${name} after millimetre conversion`)
}

function isPrismatic(jointType: RobotJointDefinitionV5['type']): boolean {
  return jointType === 'prismatic'
}

export function projectJointActualForOpcUaV1(
  jointType: RobotJointDefinitionV5['type'],
  actualPosition: number,
): JointEngineeringValueV1 {
  return Object.freeze(isPrismatic(jointType)
    ? { value: millimetres(actualPosition, 'Joint actual position'), unit: 'millimetre' as const }
    : { value: finiteValue(actualPosition, 'Joint actual position'), unit: 'degree' as const })
}

export function projectJointRangeForOpcUaV1(
  jointType: RobotJointDefinitionV5['type'],
  minimum: number,
  maximum: number,
): JointEngineeringRangeV1 {
  return Object.freeze(isPrismatic(jointType)
    ? {
        low: millimetres(minimum, 'Joint minimum'),
        high: millimetres(maximum, 'Joint maximum'),
      }
    : {
        low: finiteValue(minimum, 'Joint minimum'),
        high: finiteValue(maximum, 'Joint maximum'),
      })
}

function projectAxis(
  joint: RobotJointDefinitionV5,
  actualPosition: number,
): RoboticsAxisProjectionV1 {
  const actual = projectJointActualForOpcUaV1(joint.type, actualPosition)
  const range = projectJointRangeForOpcUaV1(joint.type, joint.min, joint.max)
  return Object.freeze({
    jointId: joint.id,
    browseName: joint.id,
    kind: joint.type,
    actualPosition: actual.value,
    minimum: range.low,
    maximum: range.high,
    engineeringUnit: actual.unit,
  })
}

function projectPowerTrain(robotId: string, joint: RobotJointDefinitionV5): RoboticsPowerTrainProjectionV1 {
  return Object.freeze({
    id: `${robotId}/${joint.id}/power-train`,
    browseName: `${joint.id} Power Train`,
    axisId: joint.id,
  })
}

function projectMotionDevice(
  robot: WorkcellProjectV5['robots'][number],
  definition: RobotDefinitionV5,
): RoboticsMotionDeviceProjectionV1 {
  const axes = Object.freeze(definition.joints.map((joint) => projectAxis(joint, robot.initialJointValues[joint.id]!)))
  const powerTrains = Object.freeze(definition.joints.map((joint) => projectPowerTrain(robot.id, joint)))
  return Object.freeze({
    id: robot.id,
    browseName: robot.name,
    manufacturer: definition.identification.manufacturer,
    model: definition.identification.model,
    productCode: definition.identification.productCode,
    serialNumber: robot.serialNumber,
    category: definition.identification.motionDeviceCategory,
    controllerId: robot.controllerId,
    axes,
    powerTrains,
  })
}

function projectController(controller: RobotControllerV5): RobotControllerV5 {
  return Object.freeze({
    ...controller,
    identification: Object.freeze({ ...controller.identification }),
  })
}

/**
 * Compiles a frozen, address-space-independent representation of the validated Project.
 * Validation is repeated at this gateway boundary so broken controller, definition, or
 * joint-state relationships are rejected before any OPC UA objects can be created.
 */
export function projectRoboticsSystemV1(projectInput: WorkcellProjectV5): RoboticsSystemProjectionV1 {
  const project = validateWorkcellProjectV5(projectInput)
  const definitionsById = new Map(project.robotDefinitions.map((definition) => [definition.id, definition]))
  const motionDevices = Object.freeze(project.robots.map((robot) => {
    const definition = definitionsById.get(robot.definitionId)
    if (definition === undefined) {
      throw new Error(`ROBOT_DEFINITION_NOT_FOUND: Robot Definition ${robot.definitionId} is not defined.`)
    }
    return projectMotionDevice(robot, definition)
  }))

  return Object.freeze({
    projectId: project.projectId,
    revisionId: project.revisionId,
    motionDevices,
    controllers: Object.freeze(project.controllers.map(projectController)),
    safety: Object.freeze({ value: 'unavailable', informationalOnly: true }),
  })
}
