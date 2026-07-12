import { describe, expect, it } from 'vitest'
import { validateOpcUaConnectorConfig } from './opcua-config.mjs'

function validConfig() {
  return {
    endpointUrl: 'opc.tcp://plc.local:4840',
    websocketPort: 4841,
    healthPort: 8081,
    samplingIntervalMs: 100,
    reconnectDelayMs: 2000,
    joints: Array.from({ length: 6 }, (_, index) => ({
      id: `J${index + 1}`,
      nodeId: `ns=2;s=Robot.J${index + 1}`,
      scale: 1,
      offset: 0,
    })),
    equipment: [
      { id: 'machine-01', nodeId: 'ns=2;s=Machine.Status', scale: 2, offset: 1 },
    ],
  }
}

describe('validateOpcUaConnectorConfig', () => {
  it('returns an owned normalized connector configuration', () => {
    const source = validConfig()
    const config = validateOpcUaConnectorConfig(source)

    expect(config).toEqual(source)
    expect(config).not.toBe(source)
    expect(config.joints).not.toBe(source.joints)
  })

  it('requires exactly six ordered joint mappings', () => {
    expect(() => validateOpcUaConnectorConfig({ ...validConfig(), joints: [] }))
      .toThrow('exactly six')
    const wrongOrder = validConfig()
    wrongOrder.joints[0]!.id = 'J2'
    expect(() => validateOpcUaConnectorConfig(wrongOrder)).toThrow('J1')
  })

  it.each([
    ['websocketPort', 0],
    ['healthPort', -1],
    ['samplingIntervalMs', 0],
    ['reconnectDelayMs', Number.NaN],
  ])('rejects invalid %s', (field, value) => {
    expect(() => validateOpcUaConnectorConfig({ ...validConfig(), [field]: value }))
      .toThrow(field)
  })

  it('rejects blank NodeIds and non-finite mapping values', () => {
    const blankNode = validConfig()
    blankNode.joints[2]!.nodeId = ' '
    expect(() => validateOpcUaConnectorConfig(blankNode)).toThrow('nodeId')

    const invalidScale = validConfig()
    invalidScale.equipment[0]!.scale = Number.POSITIVE_INFINITY
    expect(() => validateOpcUaConnectorConfig(invalidScale)).toThrow('scale')
  })
})
