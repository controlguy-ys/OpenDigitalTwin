import { beforeEach, describe, expect, it } from 'vitest'
import {
  ROBOT_CONFIGURATION_STORAGE_KEY,
  robotConfigurationToDefinition,
  useRobotConfigurationStore,
} from './robot-configuration-store'

describe('robot configuration store', () => {
  beforeEach(() => {
    localStorage.removeItem(ROBOT_CONFIGURATION_STORAGE_KEY)
    useRobotConfigurationStore.getState().resetToDatasheet()
  })

  it('edits mechanical dimensions, limits, velocity, and base pose', () => {
    const store = useRobotConfigurationStore.getState()
    store.setBasePose([0.5, -0.2, 0.1], [10, 20, 30])
    store.updateJoint(2, {
      origin: [0, 0, 0.8],
      minDeg: -200,
      maxDeg: 90,
      maxVelocityDegPerSec: 120,
    })

    const configuration = useRobotConfigurationStore.getState().configuration
    expect(configuration.basePosition).toEqual([0.5, -0.2, 0.1])
    expect(configuration.baseRotationDeg).toEqual([10, 20, 30])
    expect(configuration.joints[2]).toMatchObject({
      origin: [0, 0, 0.8],
      minDeg: -200,
      maxDeg: 90,
      maxVelocityDegPerSec: 120,
    })
    expect(robotConfigurationToDefinition(configuration).joints[2]?.origin).toEqual([
      0,
      0,
      0.8,
    ])
  })

  it('restores a persisted user configuration', () => {
    useRobotConfigurationStore.getState().updateJoint(0, { maxDeg: 123 })
    useRobotConfigurationStore.getState().resetToDatasheet()
    useRobotConfigurationStore.getState().hydrate()

    expect(
      useRobotConfigurationStore.getState().configuration.joints[0]?.maxDeg,
    ).toBe(123)
  })

  it('rejects invalid limits and non-axis vectors', () => {
    expect(() =>
      useRobotConfigurationStore.getState().updateJoint(0, {
        minDeg: 10,
        maxDeg: -10,
      }),
    ).toThrow('minimum')
    expect(() =>
      useRobotConfigurationStore.getState().updateJoint(0, {
        axis: [0, 0, 0],
      }),
    ).toThrow('axis')
  })
})
