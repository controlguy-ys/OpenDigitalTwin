import type { OcctSuccessResult } from '../../lib/cad/occt-types'
import { stepImportClient } from './StepImportClient'
import {
  createThreeGroupFromOcct,
  type ImportOriginMode,
  type ImportedThreeAsset,
  type ThreeImportOptions,
} from './occt-to-three'

export interface StepImportParser {
  /** Implementations must preserve the caller-owned source buffer. */
  import(source: ArrayBuffer | Uint8Array): Promise<OcctSuccessResult>
}

export interface ImportedGeometrySourceRecord {
  readonly id: string
  readonly sourceFileName: string
  readonly sourceBytes: ArrayBuffer | Uint8Array
  readonly postImportScale: number
  readonly originMode: ImportOriginMode
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

  load(record: ImportedGeometrySourceRecord): Promise<ImportedThreeAsset> {
    const cached = this.entries.get(record.id)
    if (cached !== undefined) {
      return Promise.resolve(cached)
    }
    const pending = this.inFlight.get(record.id)
    if (pending !== undefined) {
      return pending
    }
    if (record.sourceBytes.byteLength === 0) {
      return Promise.reject(
        new Error('Imported geometry source bytes are empty.'),
      )
    }

    const epoch = this.epochs.get(record.id) ?? 0
    const sourceBytes = record.sourceBytes
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
          postImportScale: record.postImportScale,
          originMode: record.originMode,
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

  async restore(records: readonly ImportedGeometrySourceRecord[]): Promise<void> {
    await Promise.allSettled(
      records.map((record) => this.load(record)),
    )
  }

  set(id: string, asset: ImportedThreeAsset): void {
    this.invalidate(id)
    this.entries.set(id, asset)
    this.errors.delete(id)
    this.emit()
  }

  exchangeAll(nextEntries: ReadonlyMap<string, ImportedThreeAsset>): ReadonlyMap<string, ImportedThreeAsset> {
    const previous = this.entries
    this.entries = new Map(nextEntries)
    this.inFlight.clear()
    this.errors.clear()
    this.emit()
    return previous
  }

  replaceAll(nextEntries: ReadonlyMap<string, ImportedThreeAsset>): void {
    const previous = this.exchangeAll(nextEntries)
    for (const [id, asset] of previous) {
      if (nextEntries.get(id) !== asset) asset.dispose()
    }
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
