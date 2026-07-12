import { describe, expect, it } from 'vitest'
import {
  MAX_ROBOT_STEP_FILES,
  mapRobotStepFiles,
  validateRobotStepFiles,
} from './robot-step-import'

function file(name: string, size = 10): File {
  return new File([new Uint8Array(size)], name)
}

describe('robot STEP import limits', () => {
  it('maps ABB-style filenames to LINK00 through LINK06', () => {
    const files = [
      file('robot_LINK02_CAD.step'),
      file('robot_LINK00_CAD.stp'),
      file('robot_LINK01_CAD.step'),
    ]

    expect(mapRobotStepFiles(files).map(({ linkId }) => linkId)).toEqual([
      'LINK00',
      'LINK01',
      'LINK02',
    ])
  })

  it('rejects more than seven files and duplicate or unsupported links', () => {
    expect(MAX_ROBOT_STEP_FILES).toBe(7)
    expect(() =>
      validateRobotStepFiles(
        Array.from({ length: 8 }, (_, index) => file(`part-${index}.step`)),
      ),
    ).toThrow('maximum of 7')
    expect(() =>
      mapRobotStepFiles([file('LINK00.step'), file('copy_LINK00.step')]),
    ).toThrow('Duplicate LINK00')
    expect(() => mapRobotStepFiles([file('LINK07.step')])).toThrow('LINK00 through LINK06')
  })

  it('uses file order for generic names while retaining the seven-link cap', () => {
    const mapped = mapRobotStepFiles([file('base.step'), file('arm.step')])
    expect(mapped.map(({ linkId }) => linkId)).toEqual(['LINK00', 'LINK01'])
  })
})
