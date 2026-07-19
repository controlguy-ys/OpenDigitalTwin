import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV5 } from '../project-v5/test-support'
import {
  MAX_RUNTIME_BATCH_BYTES_V1,
  MAX_RUNTIME_COMMANDS_V1,
  MAX_RUNTIME_FIXED_ARRAY_ELEMENTS_V1,
  MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1,
  MAX_RUNTIME_STATE_VALUES_V1,
  MAX_RUNTIME_STRUCTURE_LEAVES_V1,
  RUNTIME_PROTOCOL_VERSION_V1,
  RuntimeProtocolV1Error,
  validateCommandBatchV1,
  validateCommandRequestV1,
  validateCommandResultV1,
  validateRevisionActivateRequestV1,
  validateRevisionActivateResultV1,
  validateRevisionRollbackRequestV1,
  validateRevisionRollbackResultV1,
  validateRevisionStageRequestV1,
  validateRevisionStageResultV1,
  validateRuntimeMappedValueV1,
  validateRuntimeProtocolV1Message,
  validateRuntimePublisherLeaseV1,
  validateStateBatchV1,
} from './v1'
import type {
  CommandAcknowledgementV1,
  CommandExecutionStateV1,
  RuntimeScalarOrStructureV1,
} from './v1'

const CONFIG_REVISION = 'a'.repeat(64)
const encoder = new TextEncoder()

function mappedValue(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    mappingId: 'mapping-1',
    coherenceGroupId: null,
    value: 1,
    unit: 'deg',
    quality: 'GOOD',
    statusCode: 'Good',
    ...overrides,
  }
}

function stateBatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'state-batch-v1',
    protocolVersion: 1,
    gatewayId: 'gateway-1',
    projectId: 'project-v4',
    configRevision: CONFIG_REVISION,
    endpointId: 'endpoint-1',
    sequence: 1,
    sourceTimestampMs: 100,
    publishedTimestampMs: 90,
    originId: 'origin-1',
    values: [mappedValue()],
    ...overrides,
  }
}

function commandRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'command-request-v1',
    protocolVersion: 1,
    commandId: 'command-1',
    projectId: 'project-v4',
    configRevision: CONFIG_REVISION,
    leaseGeneration: 1,
    expiresAt: 0,
    targetId: 'target-1',
    ...overrides,
  }
}

function commandItem(index = 1, overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    commandId: `command-${index}`,
    expiresAt: 0,
    targetId: `target-${index}`,
    value: index,
    ...overrides,
  }
}

function commandBatch(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'command-batch-v1',
    protocolVersion: 1,
    projectId: 'project-v4',
    configRevision: CONFIG_REVISION,
    leaseGeneration: 1,
    commands: [commandItem()],
    ...overrides,
  }
}

function commandResult(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'command-result-v1',
    protocolVersion: 1,
    projectId: 'project-v4',
    configRevision: CONFIG_REVISION,
    leaseGeneration: 1,
    targetId: 'target-1',
    commandId: 'command-1',
    acknowledgement: 'IDLE',
    executionState: 'IDLE',
    failureCode: null,
    message: '',
    attachedObjectId: null,
    completedAt: null,
    ...overrides,
  }
}

function failure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    code: 'REVISION_STAGE_FAILED',
    path: '$.project',
    message: 'Stage failed.',
    ...overrides,
  }
}

function revisionStageRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-stage-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    configRevision: CONFIG_REVISION,
    project: makeMinimalWorkcellProjectV5(),
    ...overrides,
  }
}

function revisionStageSuccess(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-stage-result-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    ok: true,
    projectId: 'project-v4',
    configRevision: CONFIG_REVISION,
    stageToken: 'stage-token-1',
    ...overrides,
  }
}

function revisionStageFailure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-stage-result-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    ok: false,
    failure: failure(),
    ...overrides,
  }
}

function revisionActivateRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-activate-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    stageToken: 'stage-token-1',
    ...overrides,
  }
}

function revisionActivateSuccess(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-activate-result-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    ok: true,
    projectId: 'project-v4',
    configRevision: CONFIG_REVISION,
    ...overrides,
  }
}

function revisionActivateFailure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-activate-result-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    ok: false,
    failure: failure(),
    ...overrides,
  }
}

function revisionRollbackRequest(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-rollback-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    stageToken: 'stage-token-1',
    ...overrides,
  }
}

function revisionRollbackSuccess(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-rollback-result-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    ok: true,
    stageToken: 'stage-token-1',
    ...overrides,
  }
}

function revisionRollbackFailure(overrides: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    type: 'revision-rollback-result-v1',
    protocolVersion: 1,
    requestId: 'request-1',
    ok: false,
    failure: failure(),
    ...overrides,
  }
}

function expectProtocolError(
  action: () => unknown,
  code = 'RUNTIME_PROTOCOL_INVALID',
  path?: string,
  messageFragment?: string,
): void {
  let thrown: unknown
  try {
    action()
  } catch (error) {
    thrown = error
  }
  expect(thrown).toBeInstanceOf(RuntimeProtocolV1Error)
  expect(thrown).toMatchObject({ code, ...(path === undefined ? {} : { path }) })
  if (messageFragment !== undefined) {
    expect((thrown as Error).message).toContain(messageFragment)
  }
}

function expectDeepFrozen(value: unknown, visited = new WeakSet<object>()): void {
  if (value === null || typeof value !== 'object' || visited.has(value)) return
  visited.add(value)
  expect(Object.isFrozen(value)).toBe(true)
  for (const child of Object.values(value)) expectDeepFrozen(child, visited)
}

function nestedValue(depth: number): RuntimeScalarOrStructureV1 {
  let value: RuntimeScalarOrStructureV1 = 1
  for (let index = 0; index < depth; index += 1) value = { a: value }
  return value
}

function stateBatchAtEncodedSize(byteLength: number): Record<string, unknown> {
  const batch = stateBatch({ values: [mappedValue({ value: '' })] })
  const emptyLength = encoder.encode(JSON.stringify(batch)).byteLength
  const padding = byteLength - emptyLength
  if (padding < 0) throw new Error('Requested State Batch size is below its fixed envelope size.')
  ;((batch.values as Record<string, unknown>[])[0]!).value = 'x'.repeat(padding)
  expect(encoder.encode(JSON.stringify(batch)).byteLength).toBe(byteLength)
  return batch
}

function commandBatchAtEncodedSize(byteLength: number): Record<string, unknown> {
  const batch = commandBatch({ commands: [commandItem(1, { value: '' })] })
  const emptyLength = encoder.encode(JSON.stringify(batch)).byteLength
  const padding = byteLength - emptyLength
  if (padding < 0) throw new Error('Requested Command Batch size is below its fixed envelope size.')
  ;((batch.commands as Record<string, unknown>[])[0]!).value = 'x'.repeat(padding)
  expect(encoder.encode(JSON.stringify(batch)).byteLength).toBe(byteLength)
  return batch
}

function adversarialStructure(payload = ''): Record<string, unknown> {
  const structure: Record<string, unknown> = {
    10: 'ten',
    2: 'two',
    payload,
  }
  Object.defineProperty(structure, '__proto__', {
    configurable: true,
    enumerable: true,
    value: { safe: true },
    writable: true,
  })
  return structure
}

function stateBatchWithAdversarialStructureAtEncodedSize(
  byteLength: number,
): Record<string, unknown> {
  const structure = adversarialStructure()
  const batch = stateBatch({ values: [mappedValue({ value: structure })] })
  const emptyLength = encoder.encode(JSON.stringify(batch)).byteLength
  const padding = byteLength - emptyLength
  if (padding < 0) throw new Error('Requested State Batch size is below its fixed envelope size.')
  structure.payload = 'x'.repeat(padding)
  expect(encoder.encode(JSON.stringify(batch)).byteLength).toBe(byteLength)
  return batch
}

function commandBatchWithAdversarialStructureAtEncodedSize(
  byteLength: number,
): Record<string, unknown> {
  const structure = adversarialStructure()
  const batch = commandBatch({ commands: [commandItem(1, { value: structure })] })
  const emptyLength = encoder.encode(JSON.stringify(batch)).byteLength
  const padding = byteLength - emptyLength
  if (padding < 0) throw new Error('Requested Command Batch size is below its fixed envelope size.')
  structure.payload = 'x'.repeat(padding)
  expect(encoder.encode(JSON.stringify(batch)).byteLength).toBe(byteLength)
  return batch
}

describe('Runtime Protocol V1 State records', () => {
  it('exports the locked protocol version and accepts a complete independent deeply frozen State Batch', () => {
    expect(RUNTIME_PROTOCOL_VERSION_V1).toBe(1)
    const input = stateBatch({
      values: [mappedValue({ value: { z: [1, true], a: 'value' } })],
    })
    const result = validateStateBatchV1(input)

    expect(result).toMatchObject(input)
    expect(result).not.toBe(input)
    expect(result.values).not.toBe(input.values)
    expectDeepFrozen(result)

    ;((input.values as Record<string, unknown>[])[0]!.value as Record<string, unknown>).a = 'mutated'
    expect((result.values[0]!.value as Readonly<Record<string, RuntimeScalarOrStructureV1>>).a)
      .toBe('value')
  })

  it('validates a mapped value directly and accepts every quality', () => {
    for (const quality of ['GOOD', 'UNCERTAIN', 'BAD'] as const) {
      const result = validateRuntimeMappedValueV1(mappedValue({ quality }))
      expect(result.quality).toBe(quality)
      expectDeepFrozen(result)
    }
  })

  it('rejects an old positional payload and structural violations at stable paths', () => {
    expectProtocolError(
      () => validateStateBatchV1({ protocolVersion: 1, anglesDeg: [0, 0, 0, 0, 0, 0] }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ type: 'state-batch-v2' })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.type',
    )
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ protocolVersion: 2 })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.protocolVersion',
    )
    expectProtocolError(
      () => validateStateBatchV1({ ...stateBatch(), legacy: true }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )

    const missing = stateBatch()
    delete missing.gatewayId
    expectProtocolError(
      () => validateStateBatchV1(missing),
      'RUNTIME_PROTOCOL_INVALID',
      '$.gatewayId',
    )

    const sparseValues = [mappedValue()]
    sparseValues.length = 2
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ values: sparseValues })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.values',
    )

    const accessor = stateBatch()
    Object.defineProperty(accessor, 'gatewayId', {
      configurable: true,
      enumerable: true,
      get: () => 'gateway-accessor',
    })
    expectProtocolError(() => validateStateBatchV1(accessor), 'RUNTIME_PROTOCOL_INVALID', '$')

    class StateRecord {}
    expectProtocolError(
      () => validateStateBatchV1(Object.assign(new StateRecord(), stateBatch())),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
  })

  it('reports the first invalid declaration-order field before a later invalid values field', () => {
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ protocolVersion: 2, values: [] })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.protocolVersion',
    )
    expectProtocolError(
      () => validateRuntimeMappedValueV1(mappedValue({
        mappingId: 'bad/id',
        coherenceGroupId: 'also/bad',
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.mappingId',
    )
  })

  it('accepts 128 State values and rejects 129 with the dedicated limit code', () => {
    const exact = Array.from({ length: MAX_RUNTIME_STATE_VALUES_V1 }, (_, index) => (
      mappedValue({ mappingId: `mapping-${index + 1}` })
    ))
    expect(validateStateBatchV1(stateBatch({ values: exact })).values).toHaveLength(128)

    const plusOne = [...exact, mappedValue({ mappingId: 'mapping-129' })]
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ values: plusOne })),
      'RUNTIME_STATE_BATCH_VALUE_LIMIT_EXCEEDED',
      '$.values',
    )
  })

  it('rejects duplicate Mapping identity and accepts a source clock ahead of publication', () => {
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({
        values: [mappedValue(), mappedValue({ value: 2 })],
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.values[1].mappingId',
    )
    expect(validateStateBatchV1(stateBatch({
      sourceTimestampMs: 200,
      publishedTimestampMs: 100,
    })).sourceTimestampMs).toBe(200)
  })

  it('enforces recursive depth, fixed-array, and scalar-Leaf accounting', () => {
    expect(() => validateRuntimeMappedValueV1(mappedValue({ value: nestedValue(4) })))
      .not.toThrow()
    expectProtocolError(
      () => validateRuntimeMappedValueV1(mappedValue({ value: nestedValue(5) })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.value["a"]["a"]["a"]["a"]["a"]',
    )

    const exactLeaves = Object.fromEntries(
      Array.from({ length: MAX_RUNTIME_STRUCTURE_LEAVES_V1 }, (_, index) => [`leaf-${index}`, index]),
    )
    expect(() => validateRuntimeMappedValueV1(mappedValue({ value: exactLeaves }))).not.toThrow()
    expectProtocolError(
      () => validateRuntimeMappedValueV1(mappedValue({
        value: { ...exactLeaves, 'leaf-32': 32 },
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.value',
      '32 scalar leaves',
    )

    const withinLeafBudget = Array.from({ length: MAX_RUNTIME_STRUCTURE_LEAVES_V1 }, () => 0)
    expect(() => validateRuntimeMappedValueV1(mappedValue({ value: withinLeafBudget }))).not.toThrow()

    const arrayAtStructuralLimit = Array.from(
      { length: MAX_RUNTIME_FIXED_ARRAY_ELEMENTS_V1 },
      () => 0,
    )
    expectProtocolError(
      () => validateRuntimeMappedValueV1(mappedValue({ value: arrayAtStructuralLimit })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.value',
      '32 scalar leaves',
    )
    expectProtocolError(
      () => validateRuntimeMappedValueV1(mappedValue({ value: [...arrayAtStructuralLimit, 0] })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.value',
      '256 entries',
    )
  })

  it.each([
    true,
    1.5,
    'text',
    [1, false, 'text'],
    { 'Axis X': 1, nested: { enabled: true } },
  ] as const)('accepts runtime scalar or structure value %#', (value) => {
    expect(validateRuntimeMappedValueV1(mappedValue({ value })).value).toEqual(value)
  })

  it('preserves own __proto__ and numeric-looking keys on a standalone mapped value', () => {
    const result = validateRuntimeMappedValueV1(mappedValue({
      value: adversarialStructure('standalone'),
    }))
    const structure = result.value as Readonly<Record<string, RuntimeScalarOrStructureV1>>

    expect(Object.getPrototypeOf(structure)).toBe(Object.prototype)
    expect(Object.hasOwn(structure, '__proto__')).toBe(true)
    expect(structure['__proto__']).toEqual({ safe: true })
    expect(structure['10']).toBe('ten')
    expect(structure['2']).toBe('two')
    expect(JSON.stringify(structure)).toContain('"__proto__":{"safe":true}')
    expectDeepFrozen(structure)
    expect(Object.isFrozen(structure['__proto__'])).toBe(true)
  })

  it('clones Proxy arrays from validated index descriptors without calling a replacement map', () => {
    let mapReads = 0
    const value = new Proxy([1, 2], {
      get(target, property, receiver) {
        if (property === 'map') {
          mapReads += 1
          return () => [99]
        }
        return Reflect.get(target, property, receiver)
      },
    })

    expect(validateRuntimeMappedValueV1(mappedValue({ value })).value).toEqual([1, 2])
    expect(mapReads).toBe(0)
  })

  it('cannot hide forbidden null or function Array entries behind a Proxy map replacement', () => {
    for (const forbidden of [null, () => undefined]) {
      const value = new Proxy([forbidden], {
        get(target, property, receiver) {
          if (property === 'map') return () => [1]
          return Reflect.get(target, property, receiver)
        },
      })
      expectProtocolError(
        () => validateRuntimeMappedValueV1(mappedValue({ value })),
        'RUNTIME_PROTOCOL_INVALID',
        '$.value[0]',
      )
    }
  })

  it('uses record descriptor snapshots instead of changing or throwing Proxy get traps', () => {
    let changingGetReads = 0
    const changingValue = new Proxy({ stable: 1 }, {
      get() {
        changingGetReads += 1
        return 99
      },
    })
    const changingResult = validateRuntimeMappedValueV1(mappedValue({ value: changingValue }))
    expect(changingResult.value).toEqual({ stable: 1 })
    expect(changingGetReads).toBe(0)

    const throwingRecord = new Proxy(mappedValue(), {
      get() {
        throw new Error('raw get trap must not escape')
      },
    })
    expect(validateRuntimeMappedValueV1(throwingRecord).mappingId).toBe('mapping-1')

    const throwingArray = new Proxy([1], {
      get() {
        throw new Error('raw Array get trap must not escape')
      },
    })
    expect(validateRuntimeMappedValueV1(mappedValue({ value: throwingArray })).value).toEqual([1])
  })

  it('uses descriptor snapshots for proxied State values and Command items', () => {
    let stateIndexReads = 0
    const values = new Proxy([mappedValue()], {
      get(target, property, receiver) {
        if (property === '0') {
          stateIndexReads += 1
          return mappedValue({ value: null })
        }
        return Reflect.get(target, property, receiver)
      },
    })
    expect(validateStateBatchV1(stateBatch({ values })).values[0]!.value).toBe(1)
    expect(stateIndexReads).toBe(0)

    let commandIndexReads = 0
    const commands = new Proxy([commandItem()], {
      get(target, property, receiver) {
        if (property === '0') {
          commandIndexReads += 1
          return commandItem(1, { value: null })
        }
        return Reflect.get(target, property, receiver)
      },
    })
    expect(validateCommandBatchV1(commandBatch({ commands })).commands[0]!.value).toBe(1)
    expect(commandIndexReads).toBe(0)
  })

  it('converts throwing Proxy reflection traps to stable protocol errors', () => {
    const reflectionFailures: Array<readonly [string, () => unknown]> = [
      ['ownKeys', () => new Proxy({ stable: 1 }, {
        ownKeys() { throw new Error('ownKeys trap') },
      })],
      ['getPrototypeOf', () => new Proxy({ stable: 1 }, {
        getPrototypeOf() { throw new Error('getPrototypeOf trap') },
      })],
      ['getOwnPropertyDescriptor', () => new Proxy({ stable: 1 }, {
        getOwnPropertyDescriptor() { throw new Error('descriptor trap') },
      })],
      ['revoked Array', () => {
        const revocable = Proxy.revocable([1], {})
        revocable.revoke()
        return revocable.proxy
      }],
    ]

    for (const [_name, makeValue] of reflectionFailures) {
      expectProtocolError(
        () => validateRuntimeMappedValueV1(mappedValue({ value: makeValue() })),
        'RUNTIME_PROTOCOL_INVALID',
        '$.value',
      )
    }
  })

  it.each([
    null,
    Number.NaN,
    Number.POSITIVE_INFINITY,
    new Date(),
    new Uint8Array([1]),
    [],
    {},
  ])('rejects non-runtime value %#', (value) => {
    expectProtocolError(
      () => validateRuntimeMappedValueV1(mappedValue({ value })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.value',
    )
  })

  it('enforces exact and plus-one deterministic State Batch bytes', () => {
    expect(() => validateStateBatchV1(stateBatchAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1)))
      .not.toThrow()
    expectProtocolError(
      () => validateStateBatchV1(stateBatchAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1 + 1)),
      'RUNTIME_STATE_BATCH_SIZE_EXCEEDED',
      '$',
    )
  })

  it('counts own __proto__ and numeric-looking Structure keys in State Batch bytes', () => {
    const exact = validateStateBatchV1(
      stateBatchWithAdversarialStructureAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1),
    )
    expect(encoder.encode(JSON.stringify(exact)).byteLength).toBe(MAX_RUNTIME_BATCH_BYTES_V1)
    expectProtocolError(
      () => validateStateBatchV1(
        stateBatchWithAdversarialStructureAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1 + 1),
      ),
      'RUNTIME_STATE_BATCH_SIZE_EXCEEDED',
      '$',
    )
  })

  it('enforces positive safe sequence and non-negative safe timestamps', () => {
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ sequence: 0 })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.sequence',
    )
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ sequence: Number.MAX_SAFE_INTEGER + 1 })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.sequence',
    )
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ sourceTimestampMs: Number.NaN })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.sourceTimestampMs',
    )
    expectProtocolError(
      () => validateStateBatchV1(stateBatch({ publishedTimestampMs: -1 })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.publishedTimestampMs',
    )
  })
})

describe('Runtime Protocol V1 Command, Result, and Lease records', () => {
  it('accepts a Command Request with an absent value and rejects present undefined', () => {
    const absent = validateCommandRequestV1(commandRequest())
    expect(Object.hasOwn(absent, 'value')).toBe(false)
    expectDeepFrozen(absent)

    expectProtocolError(
      () => validateCommandRequestV1(commandRequest({ value: undefined })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.value',
    )
  })

  it.each([true, 1, 'value', [1, 2], { x: 1 }])(
    'accepts Command Request scalar or structure value %#',
    (value) => {
      expect(validateCommandRequestV1(commandRequest({ value })).value).toEqual(value)
    },
  )

  it('rejects free payload identity and invalid lease or expiry integers', () => {
    expectProtocolError(
      () => validateCommandRequestV1({ ...commandRequest(), robotId: 'robot-1' }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
    expectProtocolError(
      () => validateCommandRequestV1(commandRequest({ leaseGeneration: 0 })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.leaseGeneration',
    )
    expectProtocolError(
      () => validateCommandRequestV1(commandRequest({ expiresAt: -1 })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.expiresAt',
    )
  })

  it('accepts 128 Commands, rejects 129, and enforces unique target/command pairs', () => {
    const exact = Array.from({ length: MAX_RUNTIME_COMMANDS_V1 }, (_, index) => commandItem(index + 1))
    expect(validateCommandBatchV1(commandBatch({ commands: exact })).commands).toHaveLength(128)

    expectProtocolError(
      () => validateCommandBatchV1(commandBatch({
        commands: [...exact, commandItem(129)],
      })),
      'RUNTIME_COMMAND_BATCH_ITEM_LIMIT_EXCEEDED',
      '$.commands',
    )
    expectProtocolError(
      () => validateCommandBatchV1(commandBatch({
        commands: [commandItem(), commandItem(2, {
          commandId: 'command-1',
          targetId: 'target-1',
        })],
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.commands[1].commandId',
    )
    expect(() => validateCommandBatchV1(commandBatch({
      commands: [commandItem(), commandItem(2, { commandId: 'command-1' })],
    }))).not.toThrow()
  })

  it('reports Command envelope and Result fields in declaration order', () => {
    expectProtocolError(
      () => validateCommandBatchV1(commandBatch({ protocolVersion: 2, commands: [] })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.protocolVersion',
    )
    expectProtocolError(
      () => validateCommandResultV1(commandResult({
        type: 'command-result-v2',
        acknowledgement: 'UNKNOWN',
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.type',
    )
    expectProtocolError(
      () => validateCommandResultV1(commandResult({
        message: 'x'.repeat(MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1 + 1),
        completedAt: -1,
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.message',
    )
  })

  it('enforces exact and plus-one deterministic Command Batch bytes', () => {
    expect(() => validateCommandBatchV1(commandBatchAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1)))
      .not.toThrow()
    expectProtocolError(
      () => validateCommandBatchV1(commandBatchAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1 + 1)),
      'RUNTIME_COMMAND_BATCH_SIZE_EXCEEDED',
      '$',
    )
  })

  it('counts own __proto__ and numeric-looking Structure keys in Command Batch bytes', () => {
    const exact = validateCommandBatchV1(
      commandBatchWithAdversarialStructureAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1),
    )
    expect(encoder.encode(JSON.stringify(exact)).byteLength).toBe(MAX_RUNTIME_BATCH_BYTES_V1)
    expectProtocolError(
      () => validateCommandBatchV1(
        commandBatchWithAdversarialStructureAtEncodedSize(MAX_RUNTIME_BATCH_BYTES_V1 + 1),
      ),
      'RUNTIME_COMMAND_BATCH_SIZE_EXCEEDED',
      '$',
    )
  })

  it.each([
    ['IDLE', 'IDLE', null, null],
    ['ACCEPTED', 'RUNNING', null, null],
    ['ACCEPTED', 'SUCCEEDED', null, 100],
    ['ACCEPTED', 'FAILED', 'COMMAND_FAILED', 100],
    ['REJECTED', 'FAILED', 'COMMAND_REJECTED', 100],
  ] as const)(
    'accepts legal Result pair %s / %s',
    (acknowledgement, executionState, failureCode, completedAt) => {
      const result = validateCommandResultV1(commandResult({
        acknowledgement,
        executionState,
        failureCode,
        completedAt,
      }))
      expect(result).toMatchObject({ acknowledgement, executionState, failureCode, completedAt })
      expectDeepFrozen(result)
    },
  )

  it('rejects every illegal acknowledgement/execution cross-pair at executionState', () => {
    const legal = new Set([
      'IDLE/IDLE',
      'ACCEPTED/RUNNING',
      'ACCEPTED/SUCCEEDED',
      'ACCEPTED/FAILED',
      'REJECTED/FAILED',
    ])
    const acknowledgements: CommandAcknowledgementV1[] = ['IDLE', 'ACCEPTED', 'REJECTED']
    const states: CommandExecutionStateV1[] = ['IDLE', 'RUNNING', 'SUCCEEDED', 'FAILED']
    for (const acknowledgement of acknowledgements) {
      for (const executionState of states) {
        if (legal.has(`${acknowledgement}/${executionState}`)) continue
        expectProtocolError(
          () => validateCommandResultV1(commandResult({ acknowledgement, executionState })),
          'RUNTIME_PROTOCOL_INVALID',
          '$.executionState',
        )
      }
    }
  })

  it('enforces legal Result failure, completion, attached ID, and message fields', () => {
    expectProtocolError(
      () => validateCommandResultV1(commandResult({
        acknowledgement: 'ACCEPTED',
        executionState: 'FAILED',
        failureCode: null,
        completedAt: 100,
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.failureCode',
    )
    expectProtocolError(
      () => validateCommandResultV1(commandResult({
        acknowledgement: 'ACCEPTED',
        executionState: 'SUCCEEDED',
        failureCode: null,
        completedAt: null,
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.completedAt',
    )
    expectProtocolError(
      () => validateCommandResultV1(commandResult({ attachedObjectId: 'bad/id' })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.attachedObjectId',
    )
    expect(() => validateCommandResultV1(commandResult({
      message: 'x'.repeat(MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1),
    }))).not.toThrow()
    expectProtocolError(
      () => validateCommandResultV1(commandResult({
        message: 'x'.repeat(MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1 + 1),
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.message',
    )
  })

  it('validates and deeply freezes a Publisher Lease without contextual clock checks', () => {
    const lease = validateRuntimePublisherLeaseV1({
      projectId: 'project-v4',
      configRevision: CONFIG_REVISION,
      publisherId: 'publisher-1',
      generation: 1,
      expiresAt: 0,
    })
    expect(lease).toEqual({
      projectId: 'project-v4',
      configRevision: CONFIG_REVISION,
      publisherId: 'publisher-1',
      generation: 1,
      expiresAt: 0,
    })
    expectDeepFrozen(lease)

    expectProtocolError(
      () => validateRuntimePublisherLeaseV1({
        projectId: 'project-v4',
        configRevision: CONFIG_REVISION.toUpperCase(),
        publisherId: 'publisher-1',
        generation: 1,
        expiresAt: 0,
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$.configRevision',
    )
    expectProtocolError(
      () => validateRuntimePublisherLeaseV1({
        projectId: 'project-v4',
        configRevision: CONFIG_REVISION,
        publisherId: 'publisher-1',
        generation: 0,
        expiresAt: 0,
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$.generation',
    )
  })
})

describe('Runtime Protocol V1 Revision RPC and generic dispatch', () => {
  it('accepts a staged Project V5 and rejects a staged Project V4', () => {
    expect(validateRevisionStageRequestV1(revisionStageRequest({
      project: makeMinimalWorkcellProjectV5(),
    }))).toMatchObject({ project: { schemaVersion: 5 } })
    expect(() => validateRevisionStageRequestV1(revisionStageRequest({
      project: { schemaVersion: 4 },
    }))).toThrowError(expect.objectContaining({ code: 'PROJECT_SCHEMA_UNSUPPORTED' }))
  })

  it('validates Stage requests, deeply clones Project, and leaves a lexical hash mismatch to P4', () => {
    const request = revisionStageRequest({ configRevision: 'b'.repeat(64) })
    const result = validateRevisionStageRequestV1(request)
    expect(result.configRevision).toBe('b'.repeat(64))
    expect(result.project).not.toBe(request.project)
    expectDeepFrozen(result)

    expectProtocolError(
      () => validateRevisionStageRequestV1(revisionStageRequest({ configRevision: 'B'.repeat(64) })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.configRevision',
    )
    expectProtocolError(
      () => validateRevisionStageRequestV1(revisionStageRequest({ project: { schemaVersion: 3 } })),
      'PROJECT_SCHEMA_UNSUPPORTED',
      '$.project.schemaVersion',
    )
  })

  it('validates closed Stage success and failure result variants', () => {
    expect(validateRevisionStageResultV1(revisionStageSuccess()).ok).toBe(true)
    expect(validateRevisionStageResultV1(revisionStageFailure()).ok).toBe(false)

    expectProtocolError(
      () => validateRevisionStageResultV1({
        ...revisionStageSuccess(),
        failure: failure(),
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
    expectProtocolError(
      () => validateRevisionStageResultV1({
        ...revisionStageFailure(),
        stageToken: 'forbidden-success-field',
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
  })

  it('validates closed Activate request, success, and failure variants', () => {
    expect(validateRevisionActivateRequestV1(revisionActivateRequest()).stageToken)
      .toBe('stage-token-1')
    expect(validateRevisionActivateResultV1(revisionActivateSuccess()).ok).toBe(true)
    expect(validateRevisionActivateResultV1(revisionActivateFailure()).ok).toBe(false)

    expectProtocolError(
      () => validateRevisionActivateRequestV1({
        ...revisionActivateRequest(),
        project: makeMinimalWorkcellProjectV5(),
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
    expectProtocolError(
      () => validateRevisionActivateResultV1({
        ...revisionActivateFailure(),
        projectId: 'project-v4',
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
  })

  it('validates closed Rollback request, success, and failure variants', () => {
    expect(validateRevisionRollbackRequestV1(revisionRollbackRequest()).stageToken)
      .toBe('stage-token-1')
    expect(validateRevisionRollbackResultV1(revisionRollbackSuccess()).ok).toBe(true)
    expect(validateRevisionRollbackResultV1(revisionRollbackFailure()).ok).toBe(false)

    expectProtocolError(
      () => validateRevisionRollbackRequestV1({
        ...revisionRollbackRequest(),
        configRevision: CONFIG_REVISION,
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
    expectProtocolError(
      () => validateRevisionRollbackResultV1({
        ...revisionRollbackSuccess(),
        failure: failure(),
      }),
      'RUNTIME_PROTOCOL_INVALID',
      '$',
    )
  })

  it('validates failure code, path grammar, and UTF-8 message boundary', () => {
    expectProtocolError(
      () => validateRevisionStageResultV1(revisionStageFailure({
        failure: failure({ code: 'lowercase' }),
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.failure.code',
    )
    expectProtocolError(
      () => validateRevisionStageResultV1(revisionStageFailure({
        failure: failure({ path: 'project' }),
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.failure.path',
    )
    expect(() => validateRevisionStageResultV1(revisionStageFailure({
      failure: failure({ message: 'x'.repeat(MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1) }),
    }))).not.toThrow()
    expectProtocolError(
      () => validateRevisionStageResultV1(revisionStageFailure({
        failure: failure({ message: 'x'.repeat(MAX_RUNTIME_MESSAGE_UTF8_BYTES_V1 + 1) }),
      })),
      'RUNTIME_PROTOCOL_INVALID',
      '$.failure.message',
    )
  })

  it('dispatches every standalone V1 message and rejects an unknown type', () => {
    const messages = [
      stateBatch(),
      commandRequest(),
      commandBatch(),
      commandResult(),
      revisionStageRequest(),
      revisionStageSuccess(),
      revisionActivateRequest(),
      revisionActivateSuccess(),
      revisionRollbackRequest(),
      revisionRollbackSuccess(),
    ]
    for (const message of messages) {
      expect(validateRuntimeProtocolV1Message(message).type).toBe(message.type)
    }
    expectProtocolError(
      () => validateRuntimeProtocolV1Message({ type: 'future-message-v2', protocolVersion: 1 }),
      'RUNTIME_PROTOCOL_INVALID',
      '$.type',
    )
  })
})
