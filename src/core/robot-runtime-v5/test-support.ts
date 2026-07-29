import ned2Manifest from '../../../public/models/robot/ned2/manifest.json' with { type: 'json' }
import twoOffsetSixAxisManifest from '../../features/robot-authoring/v5/fixtures/two-offset-six-axis.robot.json' with { type: 'json' }

import { makeMinimalWorkcellProjectV5 } from '../project-v5/test-support.js'
import type { RigidTransformV5 } from '../project-v5/rigid-transform.js'
import type { RobotDefinitionV5, RobotJointDefinitionV5 } from '../project-v5/types.js'

export const SERIAL_KINEMATICS_SUCCESS_CASE_IDS_V5 = [
  'minimal-one-axis',
  'non-identity-base-pose',
  'rotated-joint-origin',
  'reverse-direction-with-offset',
  'prismatic-serial-robot',
  'nested-frames',
  'two-offset-six-axis',
  'ned2-home',
  'ned2-mid-range',
  'ned2-limit-adjacent',
] as const

export type SerialKinematicsSuccessCaseIdV5 = typeof SERIAL_KINEMATICS_SUCCESS_CASE_IDS_V5[number]

export const SERIAL_KINEMATICS_ERROR_CASE_IDS_V5 = [
  'joint-count-too-small',
  'joint-count-too-large',
  'link-count-invalid',
  'duplicate-link-id',
  'duplicate-joint-id',
  'duplicate-frame-id',
  'missing-link',
  'branched-chain',
  'cyclic-chain',
  'missing-frame-parent',
  'cyclic-frame-parent',
  'joint-key-set-mismatch',
  'hostile-accessor-record',
  'hostile-symbol-record',
  'hostile-prototype-record',
  'non-finite-command',
  'invalid-limits',
  'out-of-range-command',
  'invalid-offset',
  'invalid-direction',
  'invalid-axis',
  'unsupported-joint-type',
  'non-finite-root-position',
  'non-normalizable-root-quaternion',
] as const

export type SerialKinematicsErrorCaseIdV5 = typeof SERIAL_KINEMATICS_ERROR_CASE_IDS_V5[number]

export interface SerialKinematicsCaseInputV5 {
  readonly definition: RobotDefinitionV5
  readonly jointValues: Readonly<Record<string, number>>
  readonly worldBasePose?: RigidTransformV5
}

function minimalDefinition(): RobotDefinitionV5 {
  return structuredClone(makeMinimalWorkcellProjectV5().robotDefinitions[0]!)
}

function valuesFor(definition: RobotDefinitionV5, value: (joint: RobotJointDefinitionV5, index: number) => number = (joint) => joint.home): Record<string, number> {
  return Object.fromEntries(definition.joints.map((joint, index) => [joint.id, value(joint, index)]))
}

function addSecondJoint(definition: RobotDefinitionV5): RobotDefinitionV5 {
  const copy = structuredClone(definition)
  const source = copy.joints[0]!
  ;(copy.links as Array<RobotDefinitionV5['links'][number]>).push({ id: 'L2', name: 'Link 2', geometryOccurrences: [] })
  ;(copy.joints as RobotJointDefinitionV5[]).push({ ...source, id: 'J2', parentLinkId: 'L1', childLinkId: 'L2' })
  return copy
}

function manifestDefinition(value: unknown, sourceName: string): RobotDefinitionV5 {
  const manifest = value as {
    readonly definition: Record<string, unknown>
    readonly draft?: { readonly links: unknown; readonly joints: unknown; readonly frames: unknown }
  }
  const metadata = manifest.definition as {
    readonly id: string
    readonly name: string
    readonly identification?: unknown
    readonly manufacturer?: string
    readonly model?: string
    readonly assetReferenceIds: unknown
    readonly sourceConventions: unknown
    readonly excludedGeometryOccurrenceKeys: unknown
    readonly links?: unknown
    readonly joints?: unknown
    readonly frames?: unknown
  }
  const draft = manifest.draft ?? metadata
  return structuredClone({
    id: metadata.id,
    name: metadata.name,
    identification: metadata.identification ?? {
      manufacturer: metadata.manufacturer!,
      model: metadata.model!,
      productCode: metadata.model!,
      serialNumberTemplate: null,
      motionDeviceCategory: 'ARTICULATED_ROBOT',
    },
    mechanics: {
      schemaVersion: 1,
      status: 'confirmed',
      sourceKind: 'manifest',
      sourceName,
      calibrationRevision: 'serial-kinematics-characterization-v5',
    },
    assetReferenceIds: metadata.assetReferenceIds,
    sourceConventions: metadata.sourceConventions,
    links: draft.links,
    joints: draft.joints,
    frames: draft.frames,
    excludedGeometryOccurrenceKeys: metadata.excludedGeometryOccurrenceKeys,
  }) as unknown as RobotDefinitionV5
}

function ned2Definition(): RobotDefinitionV5 {
  // Test-only V5 projection: the production V5 model remains independent of V4 loaders.
  return manifestDefinition(ned2Manifest, 'public/models/robot/ned2/manifest.json')
}

function twoOffsetSixAxisDefinition(): RobotDefinitionV5 {
  return manifestDefinition(twoOffsetSixAxisManifest, 'two-offset-six-axis.robot.json')
}

function replaceJoint(definition: RobotDefinitionV5, index: number, patch: Partial<RobotJointDefinitionV5>): void {
  const joints = definition.joints as RobotJointDefinitionV5[]
  joints[index] = { ...joints[index]!, ...patch }
}

function replaceLinkId(definition: RobotDefinitionV5, index: number, id: string): void {
  const links = definition.links as Array<RobotDefinitionV5['links'][number]>
  links[index] = { ...links[index]!, id }
}

function replaceFrame(definition: RobotDefinitionV5, index: number, patch: Partial<RobotDefinitionV5['frames'][number]>): void {
  const frames = definition.frames as Array<RobotDefinitionV5['frames'][number]>
  frames[index] = { ...frames[index]!, ...patch }
}

function unreachableCase(caseId: never): never {
  throw new Error(`Unsupported serial kinematics characterization case: ${String(caseId)}`)
}

export function buildSerialKinematicsSuccessCaseV5(caseId: SerialKinematicsSuccessCaseIdV5): SerialKinematicsCaseInputV5 {
  switch (caseId) {
    case 'minimal-one-axis': {
      const definition = minimalDefinition()
      return { definition, jointValues: { J1: 30 } }
    }
    case 'non-identity-base-pose': {
      const definition = minimalDefinition()
      return { definition, jointValues: { J1: -45 }, worldBasePose: { positionM: [1.25, -2.5, 3.75], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] } }
    }
    case 'rotated-joint-origin': {
      const definition = minimalDefinition()
      replaceJoint(definition, 0, { origin: { positionM: [0.3, -0.2, 0.1], quaternion: [0, Math.SQRT1_2, 0, Math.SQRT1_2] } })
      return { definition, jointValues: { J1: 45 } }
    }
    case 'reverse-direction-with-offset': {
      const definition = minimalDefinition()
      replaceJoint(definition, 0, { direction: -1, zeroOffset: 10 })
      return { definition, jointValues: { J1: 20 } }
    }
    case 'prismatic-serial-robot': {
      const definition = minimalDefinition()
      replaceJoint(definition, 0, { type: 'prismatic', axis: [2, 0, 0], min: 0, max: 1, zeroOffset: 0.1 })
      return { definition, jointValues: { J1: 0.4 } }
    }
    case 'nested-frames': {
      const definition = minimalDefinition()
      ;(definition.frames as Array<RobotDefinitionV5['frames'][number]>).splice(0, definition.frames.length,
        { id: 'Base', name: 'Base', parentFrameId: 'L0', localPose: { positionM: [0.1, 0, 0], quaternion: [0, 0, 0, 1] }, role: 'base' },
        { id: 'Tool', name: 'Tool', parentFrameId: 'Base', localPose: { positionM: [0, 0.2, 0], quaternion: [0, 0, Math.SQRT1_2, Math.SQRT1_2] }, role: 'tool' },
        { id: 'TCP', name: 'TCP', parentFrameId: 'Tool', localPose: { positionM: [0, 0, 0.3], quaternion: [0, 0, 0, 1] }, role: 'tcp' },
      )
      return { definition, jointValues: { J1: 90 }, worldBasePose: { positionM: [1, 2, 3], quaternion: [0, 0, 0, 1] } }
    }
    case 'two-offset-six-axis': {
      const definition = twoOffsetSixAxisDefinition()
      return { definition, jointValues: { J1: 30, J2: -25, J3: 40, J4: -15, J5: 20, J6: 60 } }
    }
    case 'ned2-home': {
      const definition = ned2Definition()
      return { definition, jointValues: valuesFor(definition) }
    }
    case 'ned2-mid-range': {
      const definition = ned2Definition()
      return { definition, jointValues: valuesFor(definition, (joint) => (joint.min + joint.max) / 2) }
    }
    case 'ned2-limit-adjacent': {
      const definition = ned2Definition()
      return { definition, jointValues: valuesFor(definition, (joint, index) => index % 2 === 0 ? joint.min + 0.001 : joint.max - 0.001) }
    }
    default: return unreachableCase(caseId)
  }
}

export function buildSerialKinematicsErrorCaseV5(caseId: SerialKinematicsErrorCaseIdV5): SerialKinematicsCaseInputV5 {
  switch (caseId) {
    case 'joint-count-too-small': { const definition = minimalDefinition(); ;(definition.joints as RobotJointDefinitionV5[]).splice(0); return { definition, jointValues: {} } }
    case 'joint-count-too-large': { let definition = minimalDefinition(); while (definition.joints.length <= 16) definition = addSecondJoint(definition); return { definition, jointValues: valuesFor(definition) } }
    case 'link-count-invalid': { const definition = minimalDefinition(); ;(definition.links as Array<RobotDefinitionV5['links'][number]>).splice(1); return { definition, jointValues: { J1: 0 } } }
    case 'duplicate-link-id': { const definition = minimalDefinition(); replaceLinkId(definition, 1, 'L0'); return { definition, jointValues: { J1: 0 } } }
    case 'duplicate-joint-id': { const definition = addSecondJoint(minimalDefinition()); replaceJoint(definition, 1, { id: 'J1' }); return { definition, jointValues: { J1: 0 } } }
    case 'duplicate-frame-id': { const definition = minimalDefinition(); replaceFrame(definition, 1, { id: 'Base' }); return { definition, jointValues: { J1: 0 } } }
    case 'missing-link': { const definition = minimalDefinition(); replaceJoint(definition, 0, { childLinkId: 'missing' as never }); return { definition, jointValues: { J1: 0 } } }
    case 'branched-chain': { const definition = addSecondJoint(minimalDefinition()); replaceJoint(definition, 1, { parentLinkId: 'L0' }); return { definition, jointValues: { J1: 0, J2: 0 } } }
    case 'cyclic-chain': { const definition = minimalDefinition(); replaceJoint(definition, 0, { childLinkId: 'L0' }); return { definition, jointValues: { J1: 0 } } }
    case 'missing-frame-parent': { const definition = minimalDefinition(); replaceFrame(definition, 0, { parentFrameId: 'missing' as never }); return { definition, jointValues: { J1: 0 } } }
    case 'cyclic-frame-parent': { const definition = minimalDefinition(); replaceFrame(definition, 0, { parentFrameId: 'Tool' }); replaceFrame(definition, 1, { parentFrameId: 'Base' }); return { definition, jointValues: { J1: 0 } } }
    case 'joint-key-set-mismatch': return { definition: minimalDefinition(), jointValues: {} }
    case 'hostile-accessor-record': {
      const values = {} as Record<string, number>
      Object.defineProperty(values, 'J1', { enumerable: true, get: () => { throw new Error('must not invoke') } })
      return { definition: minimalDefinition(), jointValues: values }
    }
    case 'hostile-symbol-record': {
      const values = { J1: 0 } as Record<string, number>
      Object.defineProperty(values, Symbol('extra'), { enumerable: true, value: 1 })
      return { definition: minimalDefinition(), jointValues: values }
    }
    case 'hostile-prototype-record': return { definition: minimalDefinition(), jointValues: Object.create({ J1: 0 }) as Record<string, number> }
    case 'non-finite-command': return { definition: minimalDefinition(), jointValues: { J1: Number.NaN } }
    case 'invalid-limits': { const definition = minimalDefinition(); replaceJoint(definition, 0, { min: 1, max: -1 }); return { definition, jointValues: { J1: 0 } } }
    case 'out-of-range-command': return { definition: minimalDefinition(), jointValues: { J1: 181 } }
    case 'invalid-offset': { const definition = minimalDefinition(); replaceJoint(definition, 0, { zeroOffset: Number.NaN }); return { definition, jointValues: { J1: 0 } } }
    case 'invalid-direction': { const definition = minimalDefinition(); replaceJoint(definition, 0, { direction: 0 as never }); return { definition, jointValues: { J1: 0 } } }
    case 'invalid-axis': { const definition = minimalDefinition(); replaceJoint(definition, 0, { axis: [0, 0, 0] }); return { definition, jointValues: { J1: 0 } } }
    case 'unsupported-joint-type': { const definition = minimalDefinition(); replaceJoint(definition, 0, { type: 'continuous' as never }); return { definition, jointValues: { J1: 0 } } }
    case 'non-finite-root-position': return { definition: minimalDefinition(), jointValues: { J1: 0 }, worldBasePose: { positionM: [Number.NaN, 0, 0], quaternion: [0, 0, 0, 1] } }
    case 'non-normalizable-root-quaternion': return { definition: minimalDefinition(), jointValues: { J1: 0 }, worldBasePose: { positionM: [0, 0, 0], quaternion: [0, 0, 0, 0] } }
    default: return unreachableCase(caseId)
  }
}
