import { describe, expect, it } from 'vitest'

import {
  mapRobotStepFilesV4,
  validateRobotStepFilesV4,
} from './robot-step-import-v4.js'

function step(name: string, body = 'ISO-10303-21;END-ISO-10303-21;'): File {
  return new File([body], name, { type: 'model/step' })
}

describe('Robot STEP import mapping V4', () => {
  it('accepts one through seven STEP sources independently from Joint count', () => {
    expect(() => validateRobotStepFilesV4([step('assembly.step')])).not.toThrow()
    expect(() => validateRobotStepFilesV4(
      Array.from({ length: 7 }, (_, index) => step(`part-${index}.stp`, `${index}`)),
    )).not.toThrow()
    expect(() => validateRobotStepFilesV4([])).toThrow(/between 1 and 7/i)
    expect(() => validateRobotStepFilesV4(
      Array.from({ length: 8 }, (_, index) => step(`part-${index}.step`, `${index}`)),
    )).toThrow(/between 1 and 7/i)
  })

  it('maps LINK names deterministically and fills remaining links in ordinal order', () => {
    const mapping = mapRobotStepFilesV4([
      step('arm_LINK03.step'),
      step('base.step'),
      step('wrist_LINK01.stp'),
      step('tool.step'),
    ])
    expect(mapping.map(({ linkOrdinal, file }) => [linkOrdinal, file.name])).toEqual([
      [0, 'base.step'],
      [1, 'wrist_LINK01.stp'],
      [2, 'tool.step'],
      [3, 'arm_LINK03.step'],
    ])
  })

  it('rejects ambiguous duplicate LINK file names', () => {
    expect(() => mapRobotStepFilesV4([
      step('first_LINK02.step'),
      step('second_LINK02.step'),
    ])).toThrow(/Multiple STEP files map to LINK02/)
  })
})
