import { describe, expect, it, vi } from 'vitest'

import { makeMinimalWorkcellProjectV4 } from '../../../core/project-v4/test-support.js'
import type { OcctSuccessResult } from '../../../lib/cad/occt-types.js'

import { createBuiltinNed2DefinitionV4 } from './builtin-ned2-definition.js'
import {
  createRobotImportControllerV4,
  mapRobotStepFilesV4,
  ROBOT_OCCT_OUTPUT_SCALE_V4,
  validateRobotStepFilesV4,
} from './robot-step-import-v4.js'

function step(name: string, body = 'ISO-10303-21;END-ISO-10303-21;'): File {
  return new File([body], name, { type: 'model/step' })
}

function stepFileFact(name: string, size: number): File {
  return { name, size } as File
}

function sevenLinkAssemblyResult(): OcctSuccessResult {
  const meshes = Array.from({ length: 7 }, (_, index) => ({
    name: index === 0 ? 'Robot_BASE' : `Robot_J${index}`,
    color: [0.5, 0.5, 0.5] as const,
    brep_faces: [{ first: 0, last: 0, color: null }],
    attributes: {
      position: { array: [index, 0, 0, index + 0.5, 0, 0, index, 0.5, 0] },
      normal: { array: [0, 0, 1, 0, 0, 1, 0, 0, 1] },
    },
    index: { array: [0, 1, 2] },
  }))
  return {
    success: true,
    root: {
      name: 'Robot assembly',
      meshes: [],
      children: meshes.map((mesh, index) => ({
        name: mesh.name,
        meshes: [index],
        children: [],
      })),
    },
    meshes,
  }
}

describe('Robot STEP import mapping V4', () => {
  it('does not scale OCCT output that the worker already normalized to metres', () => {
    expect(ROBOT_OCCT_OUTPUT_SCALE_V4).toBe(1)
  })

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

  it('accepts a large individual STEP source and enforces only the Robot total byte budget', () => {
    expect(() => validateRobotStepFilesV4([
      stepFileFact('CX165L-BC01.stp', 43 * 1024 * 1024),
    ])).not.toThrow()
    expect(() => validateRobotStepFilesV4([
      stepFileFact('first.step', 60 * 1024 * 1024),
      stepFileFact('second.step', 41 * 1024 * 1024),
    ])).toThrow(/100 MiB total limit/i)
  })

  it('rejects ambiguous duplicate LINK file names', () => {
    expect(() => mapRobotStepFilesV4([
      step('first_LINK02.step'),
      step('second_LINK02.step'),
    ])).toThrow(/Multiple STEP files map to LINK02/)
  })

  it('publishes a seven-node assembly as moving Geometry on LINK00 through LINK06', async () => {
    let project = makeMinimalWorkcellProjectV4()
    const selectJob = vi.fn()
    const stage = vi.fn()
    const controller = createRobotImportControllerV4({
      mutations: {
        readPublished: () => ({ project }),
        replaceFromActive: async ({ mutate }: { mutate: (active: typeof project) => typeof project }) => {
          project = mutate(project)
        },
      },
      interaction: { getState: () => ({ selectJob }) },
      assets: {
        write: async () => 'created',
        read: async () => null,
        delete: async () => true,
      },
      geometry: {
        stage,
        discard: () => false,
        resolve: async () => null,
      },
      parser: {
        import: async () => sevenLinkAssemblyResult(),
        cancel: vi.fn(),
      },
      hash: { sha256: async () => 'a'.repeat(64) },
      createId: () => 'assembly-test',
    } as unknown as Parameters<typeof createRobotImportControllerV4>[0])

    await controller.importRobot([step('robot-assembly.step')], {
      name: 'Assembly Robot',
      manufacturer: 'Test',
      model: 'Seven Link',
      sourceUpAxis: 'z',
    })

    expect(project.robotDefinitions.at(-1)?.links.map((link) => (
      link.geometryOccurrences.length
    ))).toEqual([1, 1, 1, 1, 1, 1, 1])
    expect(project.robotDefinitions.at(-1)?.joints.map((joint) => (
      joint.origin.positionM
    ))).toEqual([
      [0.75, 0.25, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
      [1, 0, 0],
    ])
    const importedRobot = project.robots.at(-1)!
    expect(project.jobs.at(-1)).toEqual({
      id: 'imported-robot-job-assembly-test',
      name: 'Assembly Robot Job',
      robotId: importedRobot.id,
      steps: [],
    })
    expect(stage).toHaveBeenCalledOnce()
    expect(selectJob).toHaveBeenCalledWith(
      importedRobot.id,
      'imported-robot-job-assembly-test',
    )
  })

  it('uses the built-in NED2 topology when imported Geometry cannot derive every Link origin', async () => {
    let project = makeMinimalWorkcellProjectV4()
    const parsed = sevenLinkAssemblyResult()
    const controller = createRobotImportControllerV4({
      mutations: {
        readPublished: () => ({ project }),
        replaceFromActive: async ({ mutate }: { mutate: (active: typeof project) => typeof project }) => {
          project = mutate(project)
        },
      },
      interaction: { getState: () => ({ selectJob: vi.fn() }) },
      assets: {
        write: async () => 'created',
        read: async () => null,
        delete: async () => true,
      },
      geometry: {
        stage: vi.fn(),
        discard: () => false,
        resolve: async () => null,
      },
      parser: {
        import: async () => ({
          ...parsed,
          root: {
            ...parsed.root,
            children: parsed.root.children.slice(0, 1),
          },
          meshes: parsed.meshes.slice(0, 1),
        }),
        cancel: vi.fn(),
      },
      hash: { sha256: async () => 'b'.repeat(64) },
      createId: () => 'ned2-template-test',
    } as unknown as Parameters<typeof createRobotImportControllerV4>[0])

    await controller.importRobot([step('base.step')], {
      name: 'Partial Robot',
      manufacturer: 'Test',
      model: 'Partial Geometry',
      sourceUpAxis: 'z',
    })

    expect(project.robotDefinitions.at(-1)?.joints.map(({ origin }) => (
      origin.positionM
    ))).toEqual(createBuiltinNed2DefinitionV4().joints.map(({ origin }) => (
      origin.positionM
    )))
  })
})
