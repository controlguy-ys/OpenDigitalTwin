// @vitest-environment node

import { OPCUAServer, standardUnits } from 'node-opcua'
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

const IDENTITY_POSE = Object.freeze({ positionM: [0, 0, 0], quaternion: [0, 0, 0, 1] })

type UaNode = {
  readonly nodeId: { readonly namespace: number }
  readonly browseName: { readonly name: string }
  readonly typeDefinitionObj: { readonly browseName: { readonly name: string } } | null
  getComponentByName(name: string, namespaceIndex?: number): unknown
  getPropertyByName(name: string, namespaceIndex?: number): {
    readValue(): { value: { value: unknown } }
  } | null
  getAggregates(): readonly unknown[]
  getComponents(): readonly unknown[]
  findReferences(referenceType: unknown, isForward?: boolean): readonly { readonly nodeId: unknown }[]
  readValue(): { value: { value: unknown } }
}

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

function component(parent: UaNode, name: string, namespaceIndex: number): UaNode {
  const child = parent.getComponentByName(name, namespaceIndex)
  if (child === null) throw new Error(`Missing component ${name}`)
  return child as UaNode
}

function descendants(node: UaNode): readonly UaNode[] {
  const result = [node]
  for (const child of node.getAggregates()) {
    result.push(...descendants(child as UaNode))
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
      nodeset_filename: ROBOTICS_NODESET_FILES_V1,
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
    const system = addressSpace.findNode(model.motionSystemNodeId) as UaNode

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
    const firstActual = addressSpace.findNode(model.axisActualNodeIds['robot-1']!.J1!) as UaNode
    const secondActual = addressSpace.findNode(model.axisActualNodeIds['robot-1']!.J2!) as UaNode

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
})
