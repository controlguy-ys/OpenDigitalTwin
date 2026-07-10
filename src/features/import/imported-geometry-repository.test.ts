import { describe, expect, it, vi } from 'vitest'
import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import { ImportedGeometryRepository } from './imported-geometry-repository'

const RESULT: OcctSuccessResult = {
  success: true,
  root: { name: 'root', meshes: [0], children: [] },
  meshes: [
    {
      name: 'fixture',
      brep_faces: [],
      attributes: {
        position: {
          array: [0, 0, 0, 200, 0, 0, 0, 100, 100],
        },
      },
      index: { array: [0, 1, 2] },
    },
  ],
}

function importedRecord(id = 'imported-01'): EquipmentRecord {
  return {
    id,
    name: 'Imported 01',
    kind: 'imported',
    status: 'OFF',
    transform: {
      position: [0, 0, 1.2],
      quaternion: [0, 0, 0, 1],
      scale: [1, 1, 1],
    },
    graspable: false,
    collisionHalfExtents: [0.1, 0.05, 0.05],
    stackLightAnchor: null,
    sourceBytes: new Uint8Array([1, 2, 3, 4]).buffer,
    importMetadata: {
      sourceFileName: 'fixture.step',
      detectedUnit: 'unknown',
      selectedSourceUnit: 'millimeter',
      postImportScale: 0.001,
      originMode: 'center',
      colliderCenter: [0, 0, 0],
    },
  }
}

describe('ImportedGeometryRepository', () => {
  it('memoizes an in-flight persisted reparse and never offers the persisted buffer for transfer', async () => {
    const record = importedRecord()
    const parse = vi.fn(async (_source: ArrayBuffer | Uint8Array) => RESULT)
    const repository = new ImportedGeometryRepository({ import: parse })

    const [first, second] = await Promise.all([
      repository.load(record),
      repository.load(record),
    ])

    expect(first).toBe(second)
    expect(parse).toHaveBeenCalledTimes(1)
    expect(parse.mock.calls[0]![0]).toBe(record.sourceBytes)
    expect(record.sourceBytes?.byteLength).toBe(4)
    expect(Array.from(new Uint8Array(record.sourceBytes!))).toEqual([1, 2, 3, 4])
    expect(first.bounds.size).toEqual([0.2, 0.1, 0.1])
    expect(repository.get(record.id)).toBe(first)
  })

  it('restores each persisted imported record once across repeated hydration effects', async () => {
    const records = [importedRecord('one'), importedRecord('two')]
    const parse = vi.fn(async () => RESULT)
    const repository = new ImportedGeometryRepository({ import: parse })

    await Promise.all([repository.restore(records), repository.restore(records)])
    await repository.restore(records)

    expect(parse).toHaveBeenCalledTimes(2)
    expect(repository.get('one')).toBeDefined()
    expect(repository.get('two')).toBeDefined()
  })

  it('serializes parsing across different ids for the single-import worker contract', async () => {
    let active = false
    const parse = vi.fn(async () => {
      if (active) {
        throw new Error('A STEP import is already in progress.')
      }
      active = true
      await Promise.resolve()
      active = false
      return RESULT
    })
    const repository = new ImportedGeometryRepository({ import: parse })

    await repository.restore([
      importedRecord('queued-one'),
      importedRecord('queued-two'),
      importedRecord('queued-three'),
    ])

    expect(parse).toHaveBeenCalledTimes(3)
    expect(repository.get('queued-one')).toBeDefined()
    expect(repository.get('queued-two')).toBeDefined()
    expect(repository.get('queued-three')).toBeDefined()
  })

  it('does not copy or parse a queued record invalidated before its turn', async () => {
    let releaseFirst: (() => void) | undefined
    const firstGate = new Promise<void>((resolve) => {
      releaseFirst = resolve
    })
    const parse = vi
      .fn<(source: ArrayBuffer | Uint8Array) => Promise<OcctSuccessResult>>()
      .mockImplementationOnce(async () => {
        await firstGate
        return RESULT
      })
      .mockResolvedValue(RESULT)
    const repository = new ImportedGeometryRepository({ import: parse })
    const firstRecord = importedRecord('active')
    const queuedRecord = importedRecord('queued')
    const slice = vi.spyOn(queuedRecord.sourceBytes!, 'slice')

    const active = repository.load(firstRecord)
    const queued = repository.load(queuedRecord)
    await Promise.resolve()
    repository.invalidate(queuedRecord.id)
    releaseFirst?.()

    await expect(active).resolves.toBeDefined()
    await expect(queued).rejects.toMatchObject({ name: 'AbortError' })
    expect(slice).not.toHaveBeenCalled()
    expect(parse).toHaveBeenCalledTimes(1)
  })

  it('disposes and removes cached geometry on invalidation', async () => {
    const repository = new ImportedGeometryRepository({
      import: vi.fn(async () => RESULT),
    })
    const asset = await repository.load(importedRecord())
    const dispose = vi.spyOn(asset, 'dispose')

    repository.invalidate('imported-01')
    repository.invalidate('imported-01')

    expect(dispose).toHaveBeenCalledTimes(1)
    expect(repository.get('imported-01')).toBeUndefined()
  })

  it('does not poison retry after a parse error', async () => {
    const parse = vi
      .fn<() => Promise<OcctSuccessResult>>()
      .mockRejectedValueOnce(new Error('corrupt input'))
      .mockResolvedValueOnce(RESULT)
    const repository = new ImportedGeometryRepository({ import: parse })
    const record = importedRecord()

    await expect(repository.load(record)).rejects.toThrow('corrupt input')
    await expect(repository.load(record)).resolves.toBeDefined()
    expect(parse).toHaveBeenCalledTimes(2)
  })

  it('rejects incomplete imported persistence metadata before parsing', async () => {
    const parse = vi.fn(async () => RESULT)
    const repository = new ImportedGeometryRepository({ import: parse })
    const record = {
      ...importedRecord(),
      importMetadata: undefined,
    } as unknown as EquipmentRecord

    await expect(repository.load(record)).rejects.toThrow(/metadata/i)
    expect(parse).not.toHaveBeenCalled()
  })
})
