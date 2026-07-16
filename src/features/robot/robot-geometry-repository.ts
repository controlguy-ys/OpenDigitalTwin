import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { ImportedThreeAsset } from '../import/occt-to-three'

export class RobotGeometryRepository {
  private assets = new Map<RobotLinkId, ImportedThreeAsset>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  get(linkId: RobotLinkId): ImportedThreeAsset | undefined {
    return this.assets.get(linkId)
  }

  exchange(nextAssets: ReadonlyMap<RobotLinkId, ImportedThreeAsset>): ReadonlyMap<RobotLinkId, ImportedThreeAsset> {
    const previous = this.assets
    this.assets = new Map(nextAssets)
    this.emit()
    return previous
  }

  replace(nextAssets: ReadonlyMap<RobotLinkId, ImportedThreeAsset>): void {
    const previous = this.exchange(nextAssets)
    const retained = new Set(nextAssets.values())
    const disposed = new Set<ImportedThreeAsset>()
    for (const asset of previous.values()) {
      if (retained.has(asset) || disposed.has(asset)) continue
      disposed.add(asset)
      asset.dispose()
    }
  }

  replaceLink(linkId: RobotLinkId, nextAsset: ImportedThreeAsset): void {
    const previous = this.assets.get(linkId)
    this.assets.set(linkId, nextAsset)
    if (
      previous !== undefined && previous !== nextAsset &&
      ![...this.assets.values()].includes(previous)
    ) {
      previous.dispose()
    }
    this.emit()
  }

  clear(): void {
    this.replace(new Map())
  }

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener)
    return () => this.listeners.delete(listener)
  }

  getSnapshot = (): number => this.version

  private emit(): void {
    this.version += 1
    for (const listener of this.listeners) listener()
  }
}

export const robotGeometryRepository = new RobotGeometryRepository()
