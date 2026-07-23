import {
  DataType,
  NodeClass,
  Range,
  StatusCodes,
  Variant,
  standardUnits,
  type AddressSpace,
  type Namespace,
  type UAObject,
  type UAObjectType,
  type UAReferenceType,
  type UAVariable,
} from 'node-opcua'

import { OPC_UA_ROBOTICS_NAMESPACE_URI_V1 } from './opcua-nodeset-contract.js'
import {
  projectJointActualForOpcUaV1,
  type RoboticsAxisProjectionV1,
  type RoboticsMotionDeviceProjectionV1,
  type RoboticsSystemProjectionV1,
} from './opcua-robotics-projection.js'

export const OPC_UA_ROBOTICS_INSTANCES_NAMESPACE_URI_V1 =
  'urn:open-web-digital-twin:instances:v1' as const

export interface OpcUaRoboticsModelV1 {
  readonly motionSystemNodeId: string
  readonly axisActualNodeIds: Readonly<Record<string, Readonly<Record<string, string>>>>
  publishJointActual(robotId: string, jointId: string, projectValue: number): void
  dispose(): void
}

type RoboticsTypesV1 = Readonly<{
  motionDeviceSystem: UAObjectType
  motionDevice: UAObjectType
  axis: UAObjectType
  controller: UAObjectType
  powerTrain: UAObjectType
  safetyState: UAObjectType
}>

type PublishedAxisV1 = Readonly<{
  readonly kind: RoboticsAxisProjectionV1['kind']
  readonly actualPosition: UAVariable
}>

function nodeIdForPath(namespace: Namespace, path: string): string {
  return `ns=${namespace.index};s=${path}`
}

function requireObjectType(
  addressSpace: AddressSpace,
  roboticsNamespaceIndex: number,
  browseName: string,
): UAObjectType {
  const objectType = addressSpace.findObjectType(browseName, roboticsNamespaceIndex)
  if (objectType === null) {
    throw new Error(`OPC_UA_ROBOTICS_TYPE_NOT_FOUND: ${browseName}`)
  }
  return objectType
}

function requireReferenceType(
  addressSpace: AddressSpace,
  roboticsNamespaceIndex: number,
  browseName: string,
): UAReferenceType {
  const referenceType = addressSpace.findReferenceType(browseName, roboticsNamespaceIndex)
  if (referenceType === null) {
    throw new Error(`OPC_UA_ROBOTICS_REFERENCE_TYPE_NOT_FOUND: ${browseName}`)
  }
  return referenceType
}

function requireComponent(
  parent: UAObject,
  browseName: string,
  namespaceIndex: number,
): UAObject {
  const component = parent.getComponentByName(browseName, namespaceIndex)
  if (component === null || component.nodeClass !== NodeClass.Object) {
    throw new Error(`OPC_UA_ROBOTICS_COMPONENT_NOT_FOUND: ${browseName}`)
  }
  return component as UAObject
}

function requireVariable(
  parent: UAObject,
  browseName: string,
  namespaceIndex: number,
): UAVariable {
  const component = parent.getComponentByName(browseName, namespaceIndex)
  if (component === null || component.nodeClass !== NodeClass.Variable) {
    throw new Error(`OPC_UA_ROBOTICS_VARIABLE_NOT_FOUND: ${browseName}`)
  }
  return component as UAVariable
}

function requireProperty(
  parent: UAVariable | UAObject,
  browseName: string,
  namespaceIndex: number,
): UAVariable {
  const property = parent.getPropertyByName(browseName, namespaceIndex)
  if (property === null) {
    throw new Error(`OPC_UA_ROBOTICS_PROPERTY_NOT_FOUND: ${browseName}`)
  }
  return property
}

function setLocalizedTextProperty(
  parent: UAObject,
  browseName: string,
  namespaceIndex: number,
  value: string,
): void {
  requireProperty(parent, browseName, namespaceIndex).setValueFromSource({
    dataType: DataType.LocalizedText,
    value: { text: value },
  }, StatusCodes.Good)
}

function setStringProperty(
  parent: UAObject,
  browseName: string,
  namespaceIndex: number,
  value: string,
): void {
  requireProperty(parent, browseName, namespaceIndex).setValueFromSource({
    dataType: DataType.String,
    value,
  }, StatusCodes.Good)
}

function motionDeviceCategoryValue(
  category: RoboticsMotionDeviceProjectionV1['category'],
): number {
  const values: Readonly<Record<RoboticsMotionDeviceProjectionV1['category'], number>> = {
    OTHER: 0,
    ARTICULATED_ROBOT: 1,
    SCARA_ROBOT: 2,
    DELTA_ROBOT: 5,
  }
  return values[category]
}

function configureMotionDeviceIdentity(
  motionDevice: UAObject,
  device: RoboticsMotionDeviceProjectionV1,
  diNamespaceIndex: number,
  roboticsNamespaceIndex: number,
): void {
  setLocalizedTextProperty(motionDevice, 'Manufacturer', diNamespaceIndex, device.manufacturer)
  setLocalizedTextProperty(motionDevice, 'Model', diNamespaceIndex, device.model)
  setStringProperty(motionDevice, 'ProductCode', diNamespaceIndex, device.productCode)
  setStringProperty(motionDevice, 'SerialNumber', diNamespaceIndex, device.serialNumber)
  requireProperty(motionDevice, 'MotionDeviceCategory', roboticsNamespaceIndex).setValueFromSource({
    dataType: DataType.Int32,
    value: motionDeviceCategoryValue(device.category),
  }, StatusCodes.Good)
}

function configureActualPosition(
  instancesNamespace: Namespace,
  actualPosition: UAVariable,
  axis: RoboticsAxisProjectionV1,
  path: string,
): void {
  actualPosition.setValueFromSource({
    dataType: DataType.Double,
    value: axis.actualPosition,
  }, StatusCodes.Good)
  requireProperty(actualPosition, 'EngineeringUnits', 0).setValueFromSource({
    dataType: DataType.ExtensionObject,
    value: axis.engineeringUnit === 'degree'
      ? standardUnits.degree
      : standardUnits.millimetre,
  }, StatusCodes.Good)
  instancesNamespace.addVariable({
    propertyOf: actualPosition,
    browseName: { name: 'EURange', namespaceIndex: 0 },
    nodeId: nodeIdForPath(instancesNamespace, `${path}/EURange`),
    typeDefinition: 'PropertyType',
    dataType: 'Range',
    accessLevel: 'CurrentRead',
    userAccessLevel: 'CurrentRead',
    minimumSamplingInterval: 0,
    value: new Variant({
      dataType: DataType.ExtensionObject,
      value: new Range({ low: axis.minimum, high: axis.maximum }),
    }),
  })
}

function resolveRoboticsTypes(addressSpace: AddressSpace): Readonly<{
  readonly roboticsNamespaceIndex: number
  readonly diNamespaceIndex: number
  readonly types: RoboticsTypesV1
  readonly controlsReferenceType: UAReferenceType
  readonly movesReferenceType: UAReferenceType
}> {
  const roboticsNamespaceIndex = addressSpace.getNamespaceIndex(
    OPC_UA_ROBOTICS_NAMESPACE_URI_V1,
  )
  if (roboticsNamespaceIndex < 0) {
    throw new Error('OPC_UA_ROBOTICS_NAMESPACE_NOT_FOUND')
  }
  const diNamespaceIndex = addressSpace.getNamespaceIndex('http://opcfoundation.org/UA/DI/')
  if (diNamespaceIndex < 0) {
    throw new Error('OPC_UA_DI_NAMESPACE_NOT_FOUND')
  }
  return Object.freeze({
    roboticsNamespaceIndex,
    diNamespaceIndex,
    types: Object.freeze({
      motionDeviceSystem: requireObjectType(addressSpace, roboticsNamespaceIndex, 'MotionDeviceSystemType'),
      motionDevice: requireObjectType(addressSpace, roboticsNamespaceIndex, 'MotionDeviceType'),
      axis: requireObjectType(addressSpace, roboticsNamespaceIndex, 'AxisType'),
      controller: requireObjectType(addressSpace, roboticsNamespaceIndex, 'ControllerType'),
      powerTrain: requireObjectType(addressSpace, roboticsNamespaceIndex, 'PowerTrainType'),
      safetyState: requireObjectType(addressSpace, roboticsNamespaceIndex, 'SafetyStateType'),
    }),
    controlsReferenceType: requireReferenceType(addressSpace, roboticsNamespaceIndex, 'Controls'),
    movesReferenceType: requireReferenceType(addressSpace, roboticsNamespaceIndex, 'Moves'),
  })
}

export function instantiateOpcUaRoboticsModelV1(options: Readonly<{
  addressSpace: AddressSpace
  projection: RoboticsSystemProjectionV1
  instancesNamespace: Namespace
}>): OpcUaRoboticsModelV1 {
  const { addressSpace, projection, instancesNamespace } = options
  const {
    roboticsNamespaceIndex,
    diNamespaceIndex,
    types,
    controlsReferenceType,
    movesReferenceType,
  } = resolveRoboticsTypes(addressSpace)
  const deviceSet = addressSpace.rootFolder.objects.getFolderElementByName('DeviceSet')
  if (deviceSet === null) {
    throw new Error('OPC_UA_DEVICE_SET_NOT_FOUND')
  }

  const rootPath = `Robotics/${projection.projectId}/MotionDeviceSystem`
  const motionSystem = types.motionDeviceSystem.instantiate({
    organizedBy: deviceSet,
    browseName: { name: 'MotionDeviceSystem', namespaceIndex: instancesNamespace.index },
    nodeId: nodeIdForPath(instancesNamespace, rootPath),
    namespace: instancesNamespace,
  })
  const motionDevices = requireComponent(motionSystem, 'MotionDevices', roboticsNamespaceIndex)
  const controllers = requireComponent(motionSystem, 'Controllers', roboticsNamespaceIndex)
  const safetyStates = requireComponent(motionSystem, 'SafetyStates', roboticsNamespaceIndex)
  const publishedAxes = new Map<string, Map<string, PublishedAxisV1>>()
  const actualNodeIds = Object.create(null) as Record<string, Record<string, string>>
  const motionDevicesByController = new Map<string, UAObject[]>()

  for (const device of projection.motionDevices) {
    const devicePath = `${rootPath}/MotionDevices/${device.id}`
    const motionDevice = types.motionDevice.instantiate({
      componentOf: motionDevices,
      browseName: { name: device.browseName, namespaceIndex: instancesNamespace.index },
      nodeId: nodeIdForPath(instancesNamespace, devicePath),
      namespace: instancesNamespace,
    })
    configureMotionDeviceIdentity(
      motionDevice,
      device,
      diNamespaceIndex,
      roboticsNamespaceIndex,
    )
    const axes = requireComponent(motionDevice, 'Axes', roboticsNamespaceIndex)
    const powerTrains = requireComponent(motionDevice, 'PowerTrains', roboticsNamespaceIndex)
    const deviceAxes = new Map<string, PublishedAxisV1>()
    const deviceActualNodeIds = Object.create(null) as Record<string, string>
    const axesById = new Map<string, UAObject>()

    for (const axis of device.axes) {
      const axisPath = `${devicePath}/Axes/${axis.jointId}`
      const axisObject = types.axis.instantiate({
        componentOf: axes,
        browseName: { name: axis.browseName, namespaceIndex: instancesNamespace.index },
        nodeId: nodeIdForPath(instancesNamespace, axisPath),
        namespace: instancesNamespace,
      })
      const parameterSet = requireComponent(axisObject, 'ParameterSet', diNamespaceIndex)
      const actualPosition = requireVariable(
        parameterSet,
        'ActualPosition',
        roboticsNamespaceIndex,
      )
      configureActualPosition(
        instancesNamespace,
        actualPosition,
        axis,
        `${axisPath}/ParameterSet/ActualPosition`,
      )
      axesById.set(axis.jointId, axisObject)
      deviceAxes.set(axis.jointId, Object.freeze({ kind: axis.kind, actualPosition }))
      deviceActualNodeIds[axis.jointId] = actualPosition.nodeId.toString()
    }

    for (const powerTrain of device.powerTrains) {
      const axis = axesById.get(powerTrain.axisId)
      if (axis === undefined) {
        throw new Error(`OPC_UA_ROBOTICS_AXIS_NOT_FOUND: ${device.id}/${powerTrain.axisId}`)
      }
      const powerTrainObject = types.powerTrain.instantiate({
        componentOf: powerTrains,
        browseName: { name: powerTrain.browseName, namespaceIndex: instancesNamespace.index },
        nodeId: nodeIdForPath(instancesNamespace, `${devicePath}/PowerTrains/${powerTrain.id}`),
        namespace: instancesNamespace,
      })
      powerTrainObject.addReference({
        referenceType: movesReferenceType.nodeId,
        isForward: true,
        nodeId: axis.nodeId,
      })
    }

    const controlledDevices = motionDevicesByController.get(device.controllerId) ?? []
    controlledDevices.push(motionDevice)
    motionDevicesByController.set(device.controllerId, controlledDevices)
    publishedAxes.set(device.id, deviceAxes)
    actualNodeIds[device.id] = deviceActualNodeIds
  }

  for (const controller of projection.controllers) {
    const controllerObject = types.controller.instantiate({
      componentOf: controllers,
      browseName: { name: controller.name, namespaceIndex: instancesNamespace.index },
      nodeId: nodeIdForPath(instancesNamespace, `${rootPath}/Controllers/${controller.id}`),
      namespace: instancesNamespace,
    })
    setLocalizedTextProperty(
      controllerObject,
      'Manufacturer',
      diNamespaceIndex,
      controller.identification.manufacturer,
    )
    setLocalizedTextProperty(
      controllerObject,
      'Model',
      diNamespaceIndex,
      controller.identification.model,
    )
    setStringProperty(
      controllerObject,
      'ProductCode',
      diNamespaceIndex,
      controller.identification.productCode,
    )
    setStringProperty(
      controllerObject,
      'SerialNumber',
      diNamespaceIndex,
      controller.identification.serialNumber,
    )
    for (const controlledDevice of motionDevicesByController.get(controller.id) ?? []) {
      controllerObject.addReference({
        referenceType: controlsReferenceType.nodeId,
        isForward: true,
        nodeId: controlledDevice.nodeId,
      })
    }
  }

  types.safetyState.instantiate({
    componentOf: safetyStates,
    browseName: { name: 'SimulationSafetyState', namespaceIndex: instancesNamespace.index },
    displayName: 'Simulation Safety State (informational only; unavailable)',
    description: 'Informational simulation data only; this state is not safety-rated.',
    nodeId: nodeIdForPath(instancesNamespace, `${rootPath}/SafetyStates/SimulationSafetyState`),
    namespace: instancesNamespace,
  })

  const frozenAxisActualNodeIds = Object.freeze(Object.fromEntries(
    Object.entries(actualNodeIds).map(([robotId, jointNodeIds]) => [
      robotId,
      Object.freeze({ ...jointNodeIds }),
    ]),
  ))
  let disposed = false

  function publishJointActual(robotId: string, jointId: string, projectValue: number): void {
    const axis = publishedAxes.get(robotId)?.get(jointId)
    if (axis === undefined) {
      if (!publishedAxes.has(robotId)) {
        throw new Error(`OPC_UA_ROBOT_NOT_FOUND: ${robotId}`)
      }
      throw new Error(`OPC_UA_JOINT_NOT_FOUND: ${robotId}/${jointId}`)
    }
    const actual = projectJointActualForOpcUaV1(axis.kind, projectValue)
    axis.actualPosition.setValueFromSource({
      dataType: DataType.Double,
      value: actual.value,
    }, StatusCodes.Good, new Date())
  }

  function dispose(): void {
    if (disposed) return
    disposed = true
    publishedAxes.clear()
    instancesNamespace.deleteNode(motionSystem)
  }

  return Object.freeze({
    motionSystemNodeId: motionSystem.nodeId.toString(),
    axisActualNodeIds: frozenAxisActualNodeIds,
    publishJointActual,
    dispose,
  })
}
