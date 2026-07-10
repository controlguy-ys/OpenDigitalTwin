import { describe, expect, it } from 'vitest'
import { detectStepUnit, postImportScaleForUnit } from './detect-step-unit'

const encoder = new TextEncoder()

describe('detectStepUnit', () => {
  it.each([
    ["ISO-10303-21; SI_UNIT(.MILLI.,.METRE.); ENDSEC;", 'millimeter'],
    ["ISO-10303-21; SI_UNIT($,.METRE.); ENDSEC;", 'meter'],
    ["ISO-10303-21; CONVERSION_BASED_UNIT('INCH',#42); ENDSEC;", 'inch'],
  ] as const)('detects %s', (step, expected) => {
    expect(detectStepUnit(encoder.encode(step))).toBe(expected)
  })

  it('tolerates case and whitespace differences', () => {
    const step = "si_unit ( .milli. , .metre. ) ; conversion_based_unit ( 'inch' , #2 )"

    expect(detectStepUnit(encoder.encode(step))).toBe('millimeter')
  })

  it('finds a declaration split across bounded scan chunks', () => {
    const prefix = ' '.repeat(65_520)
    const step = `${prefix}SI_UNIT( .MILLI. , .METRE. );`

    expect(detectStepUnit(encoder.encode(step))).toBe('millimeter')
  })

  it('returns unknown when the STEP text has no unit declaration', () => {
    expect(detectStepUnit(encoder.encode('ISO-10303-21; DATA; ENDSEC;'))).toBe(
      'unknown',
    )
  })

  it.each([
    ['millimeter', 0.001],
    ['meter', 1],
    ['inch', 0.0254],
  ] as const)('uses one explicit post-import scale for unitless %s input', (unit, scale) => {
    expect(postImportScaleForUnit(unit)).toBe(scale)
  })
})
