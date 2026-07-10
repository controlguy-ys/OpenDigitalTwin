import { describe, expect, it } from 'vitest'
import { STATUS_LIGHTS } from './equipment'

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
