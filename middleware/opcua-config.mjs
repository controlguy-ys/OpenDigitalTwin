import { readFile } from 'node:fs/promises'

const JOINT_IDS = ['J1', 'J2', 'J3', 'J4', 'J5', 'J6']

function record(value, label) {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${label} must be an object.`)
  }
  return value
}

function nonEmptyString(value, label) {
  if (typeof value !== 'string' || value.trim() === '') {
    throw new Error(`${label} must be a non-empty string.`)
  }
  return value.trim()
}

function positiveInteger(value, label) {
  if (!Number.isInteger(value) || value <= 0) {
    throw new Error(`${label} must be a positive integer.`)
  }
  return value
}

function positiveNumber(value, label) {
  if (typeof value !== 'number' || !Number.isFinite(value) || value <= 0) {
    throw new Error(`${label} must be a positive finite number.`)
  }
  return value
}

function finiteNumber(value, label, fallback) {
  const candidate = value ?? fallback
  if (typeof candidate !== 'number' || !Number.isFinite(candidate)) {
    throw new Error(`${label} must be finite.`)
  }
  return candidate
}

function mapping(value, label, expectedId) {
  const source = record(value, label)
  const id = nonEmptyString(source.id, `${label} id`)
  if (expectedId !== undefined && id !== expectedId) {
    throw new Error(`${label} id must be ${expectedId}.`)
  }
  return {
    id,
    nodeId: nonEmptyString(source.nodeId, `${label} nodeId`),
    scale: finiteNumber(source.scale, `${label} scale`, 1),
    offset: finiteNumber(source.offset, `${label} offset`, 0),
  }
}

export function validateOpcUaConnectorConfig(value) {
  const source = record(value, 'OPC UA connector configuration')
  if (!Array.isArray(source.joints) || source.joints.length !== 6) {
    throw new Error('OPC UA connector configuration must define exactly six joint mappings.')
  }
  const equipment = source.equipment ?? []
  if (!Array.isArray(equipment)) {
    throw new Error('equipment must be an array.')
  }
  return {
    endpointUrl: nonEmptyString(source.endpointUrl, 'endpointUrl'),
    websocketPort: positiveInteger(source.websocketPort, 'websocketPort'),
    healthPort: positiveInteger(source.healthPort, 'healthPort'),
    samplingIntervalMs: positiveNumber(source.samplingIntervalMs, 'samplingIntervalMs'),
    reconnectDelayMs: positiveNumber(source.reconnectDelayMs, 'reconnectDelayMs'),
    joints: source.joints.map((item, index) =>
      mapping(item, `joint ${JOINT_IDS[index]}`, JOINT_IDS[index]),
    ),
    equipment: equipment.map((item, index) => mapping(item, `equipment ${index}`)),
  }
}

export async function readOpcUaConnectorConfig(path) {
  const contents = await readFile(path, 'utf8')
  return validateOpcUaConnectorConfig(JSON.parse(contents))
}
