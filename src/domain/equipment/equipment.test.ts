import { describe, expect, it } from 'vitest'
import type { EquipmentRecord } from './equipment'
import { isEquipmentRecord, STATUS_LIGHTS } from './equipment'

const VALID_RECORD: EquipmentRecord = {
  id: 'imported-valid',
  name: 'Imported Valid',
  kind: 'imported',
  status: 'RUNNING',
  transform: {
    position: [1, 2, 3],
    quaternion: [0, 0, 0, 1],
    scale: [1, 1, 1],
  },
  graspable: true,
  collisionHalfExtents: [0.1, 0.2, 0.3],
  stackLightAnchor: [0, 0, 0.4],
  sourceBytes: new Uint8Array([1, 2, 3]).buffer,
}

describe('equipment status lights', () => {
  it('maps running to the green lens only', () => {
    expect(STATUS_LIGHTS.RUNNING).toEqual({
      red: false,
      yellow: false,
      green: true,
    })
  })

  it('maps warning to the yellow lens only', () => {
    expect(STATUS_LIGHTS.WARNING).toEqual({
      red: false,
      yellow: true,
      green: false,
    })
  })

  it('maps fault to the red lens only', () => {
    expect(STATUS_LIGHTS.FAULT).toEqual({
      red: true,
      yellow: false,
      green: false,
    })
  })

  it('turns every lens off for off equipment', () => {
    expect(STATUS_LIGHTS.OFF).toEqual({
      red: false,
      yellow: false,
      green: false,
    })
  })
})

describe('equipment record validation', () => {
  it('accepts a complete serializable equipment record', () => {
    expect(isEquipmentRecord(VALID_RECORD)).toBe(true)
    expect(
      isEquipmentRecord({ ...VALID_RECORD, stackLightAnchor: null, sourceBytes: undefined }),
    ).toBe(true)
  })

  it.each([
    ['a null row', null],
    ['an empty id', { ...VALID_RECORD, id: '  ' }],
    ['a non-string name', { ...VALID_RECORD, name: 42 }],
    ['an unsupported kind', { ...VALID_RECORD, kind: 'robot' }],
    ['an unsupported status', { ...VALID_RECORD, status: 'UNKNOWN' }],
    ['a missing transform', { ...VALID_RECORD, transform: undefined }],
    [
      'a short position tuple',
      { ...VALID_RECORD, transform: { ...VALID_RECORD.transform, position: [1, 2] } },
    ],
    [
      'a non-finite position',
      {
        ...VALID_RECORD,
        transform: { ...VALID_RECORD.transform, position: [1, Number.NaN, 3] },
      },
    ],
    [
      'a short quaternion tuple',
      {
        ...VALID_RECORD,
        transform: { ...VALID_RECORD.transform, quaternion: [0, 0, 1] },
      },
    ],
    [
      'a non-finite quaternion',
      {
        ...VALID_RECORD,
        transform: {
          ...VALID_RECORD.transform,
          quaternion: [0, 0, Number.POSITIVE_INFINITY, 1],
        },
      },
    ],
    [
      'a short scale tuple',
      { ...VALID_RECORD, transform: { ...VALID_RECORD.transform, scale: [1, 1] } },
    ],
    [
      'a non-finite scale',
      {
        ...VALID_RECORD,
        transform: { ...VALID_RECORD.transform, scale: [1, Number.NaN, 1] },
      },
    ],
    ['a non-boolean graspable flag', { ...VALID_RECORD, graspable: 'yes' }],
    [
      'a short collision tuple',
      { ...VALID_RECORD, collisionHalfExtents: [0.1, 0.2] },
    ],
    [
      'a non-finite collision extent',
      { ...VALID_RECORD, collisionHalfExtents: [0.1, Number.NaN, 0.3] },
    ],
    [
      'a short stack-light anchor tuple',
      { ...VALID_RECORD, stackLightAnchor: [0, 0] },
    ],
    [
      'a non-finite stack-light anchor',
      { ...VALID_RECORD, stackLightAnchor: [0, Number.NEGATIVE_INFINITY, 0] },
    ],
    ['a typed-array source instead of ArrayBuffer', { ...VALID_RECORD, sourceBytes: new Uint8Array(3) }],
  ] satisfies readonly (readonly [string, unknown])[])('rejects %s', (_label, value) => {
    expect(isEquipmentRecord(value)).toBe(false)
  })
})
