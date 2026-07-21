import { describe, expect, it } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import { validateWorkcellProjectV4 } from '../../../core/project-v4/index.js'
import {
  bindBrObjectPosBoxesV4,
  BR_OBJECT_POS_BOX_COUNT_V4,
  BR_OBJECT_POS_ENDPOINT_ID_V4,
} from './box-objectpos-opcua-binding-v4.js'

describe('B&R ObjectPos Box binding', () => {
  it('creates 20 linear Boxes with six verified ObjectPos leaves each', () => {
    const source = makeMinimalWorkcellProjectV4()
    const bound = bindBrObjectPosBoxesV4(source)

    expect(bound.opcUa.mode).toBe('client')
    expect(bound.opcUa.endpoints).toEqual([
      expect.objectContaining({
        endpointId: BR_OBJECT_POS_ENDPOINT_ID_V4,
        endpointUrl: 'opc.tcp://127.0.0.1:4840',
        enabled: true,
      }),
    ])

    const boxes = bound.spatialEntities.filter(({ id }) => id.startsWith('box-object-pos-'))
    expect(boxes).toHaveLength(BR_OBJECT_POS_BOX_COUNT_V4)
    expect(boxes.map(({ name }) => name)).toEqual(
      Array.from({ length: 20 }, (_, index) => `ObjectPos[${index}]`),
    )
    expect(boxes.map(({ movingFrames }) => movingFrames[0]?.localPose.positionM[0])).toEqual(
      Array.from({ length: 20 }, (_, index) => index * 0.3),
    )
    expect(boxes.every((box) => box.geometry.kind === 'box')).toBe(true)
    expect(boxes.every((box) => box.transformOwner === `opcua:${BR_OBJECT_POS_ENDPOINT_ID_V4}`)).toBe(true)

    const mappings = bound.opcUa.mappings.filter(({ id }) => id.startsWith('mapping-object-pos-'))
    expect(mappings).toHaveLength(BR_OBJECT_POS_BOX_COUNT_V4)
    expect(mappings.every(({ leaves }) => leaves.length === 6)).toBe(true)
    expect(mappings[0]?.leaves.map(({ nodeId }) => nodeId)).toEqual([
      'ns=5;s=::Sample6X:ObjectPos[0].X',
      'ns=5;s=::Sample6X:ObjectPos[0].Y',
      'ns=5;s=::Sample6X:ObjectPos[0].Z',
      'ns=5;s=::Sample6X:ObjectPos[0].Roll',
      'ns=5;s=::Sample6X:ObjectPos[0].Pitch',
      'ns=5;s=::Sample6X:ObjectPos[0].Yaw',
    ])
    expect(validateWorkcellProjectV4(bound)).toEqual(bound)
  })

  it('replaces only the reserved ObjectPos set on repeat application', () => {
    const first = bindBrObjectPosBoxesV4(makeMinimalWorkcellProjectV4())
    const second = bindBrObjectPosBoxesV4(first)

    expect(second.spatialEntities).toHaveLength(BR_OBJECT_POS_BOX_COUNT_V4)
    expect(second.opcUa.mappings).toHaveLength(BR_OBJECT_POS_BOX_COUNT_V4)
    expect(second.opcUa.endpoints).toHaveLength(1)
    expect(second.spatialEntities.map(({ id }) => id)).toEqual(first.spatialEntities.map(({ id }) => id))
    expect(second.opcUa.mappings.map(({ id }) => id)).toEqual(first.opcUa.mappings.map(({ id }) => id))
  })
})
