// @vitest-environment node

import { NodeClass, OPCUAServer, standardUnits, type BaseNode, type UAObject, type UAVariable } from 'node-opcua'
import { afterEach, describe, expect, it } from 'vitest'

import {
  validateWorkcellProjectV5,
  type RobotDefinitionV5,
  type RobotInstanceV5,
  type WorkcellProjectV5,
} from '../../src/core/project-v5/index.js'
import { cloneWorkcellProjectV5, makeMinimalWorkcellProjectV5 } from '../../src/core/project-v5/test-support.js'
import { ROBOTICS_NODESET_FILES_V1 } from './opcua-nodeset-contract.js'
import {
  OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1,
  instantiateOpcUaRoboticsModelV1,
} from './opcua-robotics-model.js'
import { projectRoboticsSystemV1 } from './opcua-robotics-projection.js'

const IDENTITY_POSE = Object.freeze({
  positionM: [0, 0, 0] as const,
  quaternion: [0, 0, 0, 1] as const,
})

function projectWithJointCount(jointCount: number): WorkcellProjectV5 {
  const project = cloneWorkcellProjectV5(makeMinimalWorkcellProjectV5())
  const sourceDefinition = project.robotDefinitions[0]!
  const joints = Array.from({ length: jointCount }, (_, index) => ({
    id: `J${index + 1}`,
    type: index === jointCount - 1 ? 'prismatic' as const : 'revolute' as const,
    parentLinkId: `L${index}`,
    childLinkId: `L${index + 1}`,
    origin: IDENTITY_POSE,
    axis: [0, 0, 1] as const,
    min: index === jointCount - 1 ? -0.2 : -270,
    max: index === jointCount - 1 ? 1.5 : 270,
    home: 0,
    zeroOffset: 0,
    direction: 1 as const,
    maximumVelocity: 90,
  }))
  const definition: RobotDefinitionV5 = {
    ...sourceDefinition,
    links: Array.from({ length: jointCount + 1 }, (_, index) => index === 0
      ? sourceDefinition.links[0]!
      : { id: `L${index}`, name: `Link ${index}`, geometryOccurrences: [] }),
    joints,
  }
  const robot: RobotInstanceV5 = {
    ...project.robots[0]!,
    initialJointValues: Object.fromEntries(joints.map((joint) => [
      joint.id,
      joint.type === 'prismatic' ? 0.125 : 12.5,
    ])),
  }

  return validateWorkcellProjectV5({
    ...project,
    robotDefinitions: [definition],
    robots: [robot],
    jobs: [],
  })
}

function requireObject(node: BaseNode | null, path: string): UAObject {
  if (node === null || node.nodeClass !== NodeClass.Object) {
    throw new Error(`Expected OPC UA Object at ${path}`)
  }
  return node as UAObject
}

function requireVariable(node: BaseNode | null, path: string): UAVariable {
  if (node === null || node.nodeClass !== NodeClass.Variable) {
    throw new Error(`Expected OPC UA Variable at ${path}`)
  }
  return node as UAVariable
}

function component(parent: UAObject, name: string, namespaceIndex: number): UAObject {
  const child = parent.getComponentByName(name, namespaceIndex)
  return requireObject(child, `${parent.browseName.name}/${name}`)
}

function variable(parent: UAObject, name: string, namespaceIndex: number): UAVariable {
  const child = parent.getComponentByName(name, namespaceIndex)
  return requireVariable(child, `${parent.browseName.name}/${name}`)
}

function descendants(node: BaseNode): readonly BaseNode[] {
  const result = [node]
  for (const child of node.getAggregates()) {
    result.push(...descendants(child))
  }
  return result
}

describe('OPC UA Robotics model V1', () => {
  const servers: OPCUAServer[] = []

  afterEach(async () => {
    await Promise.all(servers.splice(0).map((server) => server.shutdown(0)))
  })

  async function startModel(project: WorkcellProjectV5) {
    const server = new OPCUAServer({
      port: 0,
      nodeset_filename: [...ROBOTICS_NODESET_FILES_V1],
    })
    servers.push(server)
    await server.initialize()

    const addressSpace = server.engine.addressSpace
    if (addressSpace === null) throw new Error('OPC_UA_ADDRESS_SPACE_UNAVAILABLE')
    const instancesNamespace = addressSpace.registerNamespace(
      OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1,
    )
    return {
      addressSpace,
      instancesNamespace,
      model: instantiateOpcUaRoboticsModelV1({
        addressSpace,
        projection: projectRoboticsSystemV1(project),
        instancesNamespace,
      }),
    }
  }

  it.each([2, 7, 16])('uses standard types and exactly %i configured Axes with product-owned instance NodeIds', async (jointCount) => {
    const { addressSpace, instancesNamespace, model } = await startModel(projectWithJointCount(jointCount))
    const roboticsNamespaceIndex = addressSpace.getNamespaceIndex('http://opcfoundation.org/UA/Robotics/')
    const system = requireObject(addressSpace.findNode(model.motionSystemNodeId), 'MotionDeviceSystem')

    expect(system.typeDefinitionObj?.browseName.name).toBe('MotionDeviceSystemType')
    expect(descendants(system).every(({ nodeId }) => nodeId.namespace === instancesNamespace.index)).toBe(true)

    const motionDevices = component(system, 'MotionDevices', roboticsNamespaceIndex)
    const device = component(motionDevices, 'Robot 1', instancesNamespace.index)
    const axes = component(device, 'Axes', roboticsNamespaceIndex)
    const powerTrains = component(device, 'PowerTrains', roboticsNamespaceIndex)
    const controllers = component(system, 'Controllers', roboticsNamespaceIndex)
    const controller = component(controllers, 'Controller 1', instancesNamespace.index)
    const safetyStates = component(system, 'SafetyStates', roboticsNamespaceIndex)
    const controlsReferenceType = addressSpace.findReferenceType('Controls', roboticsNamespaceIndex)
    const movesReferenceType = addressSpace.findReferenceType('Moves', roboticsNamespaceIndex)

    expect(device.typeDefinitionObj?.browseName.name).toBe('MotionDeviceType')
    expect(controller.typeDefinitionObj?.browseName.name).toBe('ControllerType')
    expect(safetyStates.getComponents()).toHaveLength(1)
    expect(controlsReferenceType).not.toBeNull()
    expect(controller.findReferences(controlsReferenceType!.nodeId, true)).toHaveLength(1)
    expect(axes.getComponents()).toHaveLength(jointCount)
    expect(powerTrains.getComponents()).toHaveLength(jointCount)
    expect(component(axes, 'J1', instancesNamespace.index).typeDefinitionObj?.browseName.name).toBe('AxisType')
    const powerTrain = component(powerTrains, 'J1 Power Train', instancesNamespace.index)
    expect(powerTrain.typeDefinitionObj?.browseName.name).toBe('PowerTrainType')
    expect(movesReferenceType).not.toBeNull()
    expect(powerTrain.findReferences(movesReferenceType!.nodeId, true)).toHaveLength(1)
    expect(Object.keys(model.axisActualNodeIds['robot-1']!)).toEqual(
      Array.from({ length: jointCount }, (_, index) => `J${index + 1}`),
    )
  }, 30_000)

  it('publishes engineering units and EURanges through standard read-only ActualPosition variables', async () => {
    const { addressSpace, instancesNamespace, model } = await startModel(projectWithJointCount(2))
    const firstActual = requireVariable(addressSpace.findNode(model.axisActualNodeIds['robot-1']!.J1!), 'J1 ActualPosition')
    const secondActual = requireVariable(addressSpace.findNode(model.axisActualNodeIds['robot-1']!.J2!), 'J2 ActualPosition')

    expect(firstActual.nodeId.namespace).toBe(instancesNamespace.index)
    expect(firstActual.readValue().value.value).toBe(12.5)
    expect(firstActual.getPropertyByName('EngineeringUnits')?.readValue().value.value)
      .toMatchObject({ unitId: standardUnits.degree.unitId })
    expect(firstActual.getPropertyByName('EURange')?.readValue().value.value)
      .toMatchObject({ low: -270, high: 270 })
    expect(secondActual.readValue().value.value).toBe(125)
    expect(secondActual.getPropertyByName('EngineeringUnits')?.readValue().value.value)
      .toMatchObject({ unitId: standardUnits.millimetre.unitId })
    expect(secondActual.getPropertyByName('EURange')?.readValue().value.value)
      .toMatchObject({ low: -200, high: 1_500 })

    model.publishJointActual('robot-1', 'J2', 0.75)
    expect(secondActual.readValue().value.value).toBe(750)
  }, 30_000)

  it('cleans up deterministically, is idempotent, and rejects publication after disposal', async () => {
    const { addressSpace, model } = await startModel(projectWithJointCount(2))
    const actualNodeId = model.axisActualNodeIds['robot-1']!.J1!

    model.dispose()

    expect(addressSpace.findNode(model.motionSystemNodeId)).toBeNull()
    expect(addressSpace.findNode(actualNodeId)).toBeNull()
    expect(() => model.publishJointActual('robot-1', 'J1', 10))
      .toThrow('OPC_UA_ROBOTICS_MODEL_DISPOSED')
    expect(() => model.dispose()).not.toThrow()
  }, 30_000)

  it('keeps the SafetyStateType branch informational and read-only without a command or status path', async () => {
    const { addressSpace, instancesNamespace, model } = await startModel(projectWithJointCount(2))
    const roboticsNamespaceIndex = addressSpace.getNamespaceIndex('http://opcfoundation.org/UA/Robotics/')
    const diNamespaceIndex = addressSpace.getNamespaceIndex('http://opcfoundation.org/UA/DI/')
    const system = requireObject(addressSpace.findNode(model.motionSystemNodeId), 'MotionDeviceSystem')
    const safetyStates = component(system, 'SafetyStates', roboticsNamespaceIndex)
    const safetyState = component(safetyStates, 'SimulationSafetyState', instancesNamespace.index)
    const parameterSet = component(safetyState, 'ParameterSet', diNamespaceIndex)
    const safetyVariables = ['EmergencyStop', 'OperationalMode', 'ProtectiveStop']
      .map((browseName) => variable(parameterSet, browseName, roboticsNamespaceIndex))

    expect(safetyState.typeDefinitionObj?.browseName.name).toBe('SafetyStateType')
    expect(safetyState.description?.text).toContain('Informational simulation data only')
    expect(safetyState.getComponents().map((node) => node.browseName.name))
      .toEqual(['ParameterSet'])
    expect(safetyVariables.every(({ accessLevel, userAccessLevel }) => (
      accessLevel === 1 && userAccessLevel === 1
    ))).toBe(true)
    expect(safetyState.getComponents().map((node) => node.browseName.name))
      .not.toEqual(expect.arrayContaining(['Command', 'Result', 'Status']))
  }, 30_000)
})
