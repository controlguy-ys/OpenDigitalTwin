import { describe, expect, it, vi } from 'vitest'
import { Group } from 'three'
import {
  importRobotStepFiles,
  MAX_ROBOT_STEP_FILES,
  mapRobotStepFiles,
  validateCompleteRobotStepFiles,
  validateRobotStepFiles,
  restoreRobotGeometryRecords,
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

  it('requires all seven files for a new Robot import', () => {
    expect(() => validateCompleteRobotStepFiles([file('LINK00.step')])).toThrow(
      'exactly 7',
    )
    expect(() =>
      validateCompleteRobotStepFiles(
        Array.from({ length: 7 }, (_, index) => file(`LINK0${index}.step`)),
      ),
    ).not.toThrow()
  })

  it('keeps imported geometry in its Link-local source coordinates', async () => {
    const group = new Group()
    const assets = await importRobotStepFiles(
      [file('LINK01.step')],
      {
        import: async () => ({
          success: true,
          root: { name: 'root', meshes: [], children: [] },
          meshes: [],
        }),
        cancel: () => undefined,
      },
      () => ({
        group,
        bounds: {
          min: [0, 0, 0],
          max: [1, 1, 1],
          size: [1, 1, 1],
          center: [0.5, 0.5, 0.5],
        },
        colliderCenter: [0.5, 0.5, 0.5],
        dispose: () => undefined,
      }),
    )

    expect(assets.get('LINK01')?.group.position.toArray()).toEqual([0, 0, 0])
  })

  it('parses a STEP source shared by multiple Links only once', async () => {
    const sourceBytes = new Uint8Array([1, 2, 3]).buffer
    const importSource = vi.fn(async () => ({
      success: true as const,
      root: { name: 'root', meshes: [], children: [] },
      meshes: [],
    }))
    const dispose = vi.fn()
    const convert = vi.fn(() => ({
      group: new Group(),
      bounds: {
        min: [0, 0, 0] as [number, number, number],
        max: [1, 1, 1] as [number, number, number],
        size: [1, 1, 1] as [number, number, number],
        center: [0.5, 0.5, 0.5] as [number, number, number],
      },
      colliderCenter: [0.5, 0.5, 0.5] as [number, number, number],
      dispose,
    }))
    const record = (linkId: 'LINK00' | 'LINK01') => ({
      linkId,
      sourceFileName: 'assembly.step',
      sourceBytes,
      localTransform: {
        position: [0, 0, 0] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
        scale: [1, 1, 1] as [number, number, number],
      },
      visible: true,
      collisionCenter: [0, 0, 0] as [number, number, number],
      collisionHalfExtents: [0.1, 0.1, 0.1] as [number, number, number],
      collisionBoxes: [{
        id: 'body',
        center: [0, 0, 0] as [number, number, number],
        halfExtents: [0.1, 0.1, 0.1] as [number, number, number],
        quaternion: [0, 0, 0, 1] as [number, number, number, number],
      }],
      statistics: { vertices: 3, triangles: 1, meshes: 1, materials: 1 },
    })

    const assets = await restoreRobotGeometryRecords(
      [record('LINK00'), record('LINK01')],
      { import: importSource, cancel: () => undefined },
      convert,
    )

    expect(importSource).toHaveBeenCalledTimes(1)
    expect(convert).toHaveBeenCalledTimes(1)
    expect(assets.get('LINK00')).toBe(assets.get('LINK01'))
    assets.get('LINK00')?.dispose()
    assets.get('LINK01')?.dispose()
    expect(dispose).toHaveBeenCalledTimes(1)
  })
})
