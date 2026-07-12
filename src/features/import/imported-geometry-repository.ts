import type { EquipmentRecord } from '../../domain/equipment/equipment'
import type { ObjectAssetRecordV1 } from '../../domain/project/project'
import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import { stepImportClient } from './StepImportClient'
import {
  createThreeGroupFromOcct,
  type ImportedThreeAsset,
  type ThreeImportOptions,
} from './occt-to-three'

export interface StepImportParser {
  /** Implementations must preserve the caller-owned source buffer. */
  import(source: ArrayBuffer | Uint8Array): Promise<OcctSuccessResult>
}

type GeometryConverter = (
  result: OcctSuccessResult,
  options?: ThreeImportOptions,
) => ImportedThreeAsset

export class ImportedGeometryRepository {
  private readonly parser: StepImportParser
  private readonly convert: GeometryConverter
  private entries = new Map<string, ImportedThreeAsset>()
  private readonly inFlight = new Map<string, Promise<ImportedThreeAsset>>()
  private readonly epochs = new Map<string, number>()
  private readonly errors = new Map<string, string>()
  private readonly listeners = new Set<() => void>()
  private version = 0
  private parseTail: Promise<void> = Promise.resolve()

  constructor(
    parser: StepImportParser,
    convert: GeometryConverter = createThreeGroupFromOcct,
  ) {
    this.parser = parser
    this.convert = convert
  }

  get(id: string): ImportedThreeAsset | undefined {
    return this.entries.get(id)
  }

  getError(id: string): string | undefined {
    return this.errors.get(id)
  }

  load(record: EquipmentRecord): Promise<ImportedThreeAsset> {
    const cached = this.entries.get(record.id)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }
    const pending = this.inFlight.get(record.id)
    if (pending !== undefined) {
      return pending
    }
    if (
      record.kind !== 'imported' ||
      record.sourceBytes === undefined ||
      record.importMetadata === undefined
    ) {
      return Promise.reject(
        new Error('Imported equipment is missing source bytes or import metadata.'),
      )
    }

    const epoch = this.epochs.get(record.id) ?? 0
    const sourceBytes = record.sourceBytes
    const importMetadata = record.importMetadata
    const parsePromise = this.parseTail.then(() => {
      if ((this.epochs.get(record.id) ?? 0) !== epoch) {
        throw new DOMException(
          'Imported geometry was invalidated before loading.',
          'AbortError',
        )
      }
      return this.parser.import(sourceBytes)
    })
    this.parseTail = parsePromise.then(
      () => undefined,
      () => undefined,
    )

    const importPromise = parsePromise
      .then((result) =>
        this.convert(result, {
          postImportScale: importMetadata.postImportScale,
          originMode: importMetadata.originMode,
        }),
      )
      .then((asset) => {
        if ((this.epochs.get(record.id) ?? 0) !== epoch) {
          asset.dispose()
          throw new DOMException(
            'Imported geometry was invalidated while loading.',
            'AbortError',
          )
        }

        this.entries.set(record.id, asset)
        this.errors.delete(record.id)
        this.emit()
        return asset
      })
      .catch((error: unknown) => {
        if (!(error instanceof DOMException && error.name === 'AbortError')) {
          this.errors.set(
            record.id,
            error instanceof Error ? error.message : 'Unable to restore imported geometry.',
          )
          this.emit()
        }
        throw error
      })
      .finally(() => {
        if (this.inFlight.get(record.id) === importPromise) {
          this.inFlight.delete(record.id)
        }
      })

    this.inFlight.set(record.id, importPromise)
    return importPromise
  }

  loadObjectAsset(record: ObjectAssetRecordV1): Promise<ImportedThreeAsset> {
    return this.load({
      id: record.id,
      name: record.name,
      kind: 'imported',
      status: 'OFF',
      transform: {
        position: [0, 0, 0],
        quaternion: [0, 0, 0, 1],
        scale: [1, 1, 1],
      },
      graspable: false,
      collisionHalfExtents: [...record.collisionHalfExtents],
      stackLightAnchor: null,
      sourceBytes: record.sourceBytes,
      importMetadata: {
        sourceFileName: record.sourceFileName,
        detectedUnit: 'unknown',
        selectedSourceUnit: 'meter',
        postImportScale: record.importScale,
        originMode: record.originMode,
        colliderCenter: [...record.colliderCenter],
      },
    })
  }

  async restore(records: readonly EquipmentRecord[]): Promise<void> {
    await Promise.allSettled(
      records
        .filter((record) => record.kind === 'imported')
        .map((record) => this.load(record)),
    )
  }

  async restoreObjectAssets(records: readonly ObjectAssetRecordV1[]): Promise<void> {
    await Promise.allSettled(records.map((record) => this.loadObjectAsset(record)))
  }

  set(id: string, asset: ImportedThreeAsset): void {
    this.invalidate(id)
    this.entries.set(id, asset)
    this.errors.delete(id)
    this.emit()
  }

  replaceAll(nextEntries: ReadonlyMap<string, ImportedThreeAsset>): void {
    for (const [id, asset] of this.entries) {
      if (nextEntries.get(id) !== asset) asset.dispose()
    }
    this.entries = new Map(nextEntries)
    this.inFlight.clear()
    this.errors.clear()
    this.emit()
  }

  invalidate(id: string): void {
    this.epochs.set(id, (this.epochs.get(id) ?? 0) + 1)
    const asset = this.entries.get(id)
    this.entries.delete(id)
    this.errors.delete(id)
    asset?.dispose()
    this.emit()
  }

  dispose(): void {
    const ids = new Set([...this.entries.keys(), ...this.inFlight.keys()])
    for (const id of ids) {
      this.invalidate(id)
    }
    this.listeners.clear()
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  getSnapshot = (): number => this.version

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) {
      listener()
    }
  }
}

export const importedGeometryRepository = new ImportedGeometryRepository(
  stepImportClient,
)
