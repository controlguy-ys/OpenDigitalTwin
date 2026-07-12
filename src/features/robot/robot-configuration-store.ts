import { create } from 'zustand'
import {
  CRB15000_DEFINITION,
  type RobotJointDefinition,
  type RobotLinkId,
  type Vector3Tuple,
} from '../../domain/robot/crb15000'

export const ROBOT_CONFIGURATION_STORAGE_KEY = 'robot-sim.robot-configuration.v1'

export interface EditableRobotJoint
  extends Omit<RobotJointDefinition, 'parentLink' | 'childLink'> {
  parentLink: RobotLinkId
  childLink: RobotLinkId
  maxVelocityDegPerSec: number
}

export interface RobotConfiguration {
  name: string
  basePosition: Vector3Tuple
  baseRotationDeg: Vector3Tuple
  joints: readonly EditableRobotJoint[]
}

const DEFAULT_MAX_VELOCITIES = [180, 180, 180, 320, 320, 420] as const

export function createDatasheetRobotConfiguration(): RobotConfiguration {
  return {
    name: CRB15000_DEFINITION.id,
    basePosition: [0, 0, 0],
    baseRotationDeg: [0, 0, 0],
    joints: CRB15000_DEFINITION.joints.map((joint, index) => ({
      ...joint,
      origin: [...joint.origin],
      axis: [...joint.axis],
      maxVelocityDegPerSec: DEFAULT_MAX_VELOCITIES[index]!,
    })),
  }
}

function finiteVector(value: Vector3Tuple, label: string): void {
  if (value.length !== 3 || value.some((item) => !Number.isFinite(item))) {
    throw new Error(`${label} must contain three finite numbers.`)
  }
}

function validateConfiguration(configuration: RobotConfiguration): void {
  if (configuration.name.trim() === '') throw new Error('Robot name is required.')
  finiteVector(configuration.basePosition, 'Robot base position')
  finiteVector(configuration.baseRotationDeg, 'Robot base rotation')
  if (configuration.joints.length !== 6) {
    throw new Error('Robot configuration must contain exactly six joints.')
  }
  for (const joint of configuration.joints) {
    finiteVector(joint.origin, `${joint.id} origin`)
    finiteVector(joint.axis, `${joint.id} axis`)
    const axisLength = Math.hypot(...joint.axis)
    if (axisLength <= 1e-9) throw new Error(`${joint.id} axis cannot be zero.`)
    if (!Number.isFinite(joint.minDeg) || !Number.isFinite(joint.maxDeg)) {
      throw new Error(`${joint.id} limits must be finite.`)
    }
    if (joint.minDeg >= joint.maxDeg) {
      throw new Error(`${joint.id} minimum must be less than its maximum.`)
    }
    if (
      !Number.isFinite(joint.maxVelocityDegPerSec) ||
      joint.maxVelocityDegPerSec <= 0
    ) {
      throw new Error(`${joint.id} maximum velocity must be positive.`)
    }
  }
}

function cloneConfiguration(configuration: RobotConfiguration): RobotConfiguration {
  return {
    ...configuration,
    basePosition: [...configuration.basePosition],
    baseRotationDeg: [...configuration.baseRotationDeg],
    joints: configuration.joints.map((joint) => ({
      ...joint,
      origin: [...joint.origin],
      axis: [...joint.axis],
    })),
  }
}

function persist(configuration: RobotConfiguration): void {
  try {
    localStorage.setItem(
      ROBOT_CONFIGURATION_STORAGE_KEY,
      JSON.stringify(configuration),
    )
  } catch {
    // Configuration remains active in memory if browser storage is unavailable.
  }
}

function readPersisted(): RobotConfiguration | null {
  try {
    const raw = localStorage.getItem(ROBOT_CONFIGURATION_STORAGE_KEY)
    if (raw === null) return null
    const parsed = JSON.parse(raw) as RobotConfiguration
    validateConfiguration(parsed)
    return cloneConfiguration(parsed)
  } catch {
    return null
  }
}

export function robotConfigurationToDefinition(configuration: RobotConfiguration) {
  validateConfiguration(configuration)
  return {
    id: configuration.name,
    baseLink: 'LINK00' as const,
    joints: configuration.joints.map((joint) => ({
      id: joint.id,
      parentLink: joint.parentLink,
      childLink: joint.childLink,
      origin: [...joint.origin] as Vector3Tuple,
      axis: [...joint.axis] as Vector3Tuple,
      minDeg: joint.minDeg,
      maxDeg: joint.maxDeg,
    })),
    toolRotationYRad: CRB15000_DEFINITION.toolRotationYRad,
  }
}

interface RobotConfigurationStoreState {
  configuration: RobotConfiguration
  setConfiguration(configuration: RobotConfiguration): void
  setName(name: string): void
  setBasePose(position: Vector3Tuple, rotationDeg: Vector3Tuple): void
  updateJoint(index: number, update: Partial<EditableRobotJoint>): void
  resetToDatasheet(): void
  hydrate(): void
}

export const useRobotConfigurationStore = create<RobotConfigurationStoreState>()(
  (set) => ({
    configuration: readPersisted() ?? createDatasheetRobotConfiguration(),
    setConfiguration: (configuration) => {
      const next = cloneConfiguration(configuration)
      validateConfiguration(next)
      persist(next)
      set({ configuration: next })
    },
    setName: (name) => {
      set((state) => {
        const configuration = { ...cloneConfiguration(state.configuration), name }
        validateConfiguration(configuration)
        persist(configuration)
        return { configuration }
      })
    },
    setBasePose: (basePosition, baseRotationDeg) => {
      set((state) => {
        const configuration = {
          ...cloneConfiguration(state.configuration),
          basePosition: [...basePosition] as Vector3Tuple,
          baseRotationDeg: [...baseRotationDeg] as Vector3Tuple,
        }
        validateConfiguration(configuration)
        persist(configuration)
        return { configuration }
      })
    },
    updateJoint: (index, update) => {
      if (!Number.isInteger(index) || index < 0 || index >= 6) {
        throw new RangeError('Joint index must be from 0 through 5.')
      }
      set((state) => {
        const configuration = cloneConfiguration(state.configuration)
        const current = configuration.joints[index]!
        const joints = [...configuration.joints]
        joints[index] = {
          ...current,
          ...update,
          origin: update.origin === undefined ? current.origin : [...update.origin],
          axis: update.axis === undefined ? current.axis : [...update.axis],
        }
        const next = { ...configuration, joints }
        validateConfiguration(next)
        persist(next)
        return { configuration: next }
      })
    },
    resetToDatasheet: () => set({ configuration: createDatasheetRobotConfiguration() }),
    hydrate: () => {
      const configuration = readPersisted()
      if (configuration !== null) set({ configuration })
    },
  }),
)
