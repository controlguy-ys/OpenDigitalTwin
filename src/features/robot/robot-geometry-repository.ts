import type { RobotLinkId } from '../../domain/robot/crb15000'
import type { ImportedThreeAsset } from '../import/occt-to-three'

export class RobotGeometryRepository {
  private assets = new Map<RobotLinkId, ImportedThreeAsset>()
  private readonly listeners = new Set<() => void>()
  private version = 0

  get(linkId: RobotLinkId): ImportedThreeAsset | undefined {
    return this.assets.get(linkId)
  }

  replace(nextAssets: ReadonlyMap<RobotLinkId, ImportedThreeAsset>): void {
    for (const asset of this.assets.values()) asset.dispose()
    this.assets = new Map(nextAssets)
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
