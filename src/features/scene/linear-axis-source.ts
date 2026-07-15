export interface LinearAxisFrameV1 {
  readonly positionM: number
  readonly timestampMs: number
  readonly quality: 'GOOD' | 'STALE' | 'BAD'
}

export interface LinearAxisSourceV1 {
  readonly kind: 'manual'
  subscribe(listener: (frame: LinearAxisFrameV1) => void): () => void
  setPositionM(positionM: number): Promise<void>
  home(): Promise<void>
}

export interface ManualLinearAxisSourceOptions {
  readonly initialPositionM: number
  readonly homePositionM: number
  readonly commitPositionM: (positionM: number) => Promise<void>
  readonly commitHome?: () => Promise<void>
  readonly now?: () => number
}

export class ManualLinearAxisSource implements LinearAxisSourceV1 {
  readonly kind = 'manual' as const
  private positionM: number
  private readonly homePositionM: number
  private readonly commitPositionM: (positionM: number) => Promise<void>
  private readonly commitHome: (() => Promise<void>) | undefined
  private readonly now: () => number
  private readonly listeners = new Set<(frame: LinearAxisFrameV1) => void>()

  constructor(options: ManualLinearAxisSourceOptions) {
    if (!Number.isFinite(options.initialPositionM) || !Number.isFinite(options.homePositionM)) {
      throw new Error('LINEAR_AXIS_POSITION_INVALID: Manual positions must be finite.')
    }
    this.positionM = options.initialPositionM
    this.homePositionM = options.homePositionM
    this.commitPositionM = options.commitPositionM
    this.commitHome = options.commitHome
    this.now = options.now ?? Date.now
  }

  subscribe(listener: (frame: LinearAxisFrameV1) => void): () => void {
    this.listeners.add(listener)
    return () => {
      this.listeners.delete(listener)
    }
  }

  async setPositionM(positionM: number): Promise<void> {
    if (!Number.isFinite(positionM)) {
      throw new Error('LINEAR_AXIS_POSITION_INVALID: Manual position must be finite.')
    }
    await this.commitPositionM(positionM)
    this.positionM = positionM
    const frame = Object.freeze({
      positionM: this.positionM,
      timestampMs: this.now(),
      quality: 'GOOD' as const,
    })
    for (const listener of Array.from(this.listeners)) listener(frame)
  }

  async home(): Promise<void> {
    if (this.commitHome === undefined) {
      await this.setPositionM(this.homePositionM)
      return
    }
    await this.commitHome()
    this.positionM = this.homePositionM
    const frame = Object.freeze({
      positionM: this.positionM,
      timestampMs: this.now(),
      quality: 'GOOD' as const,
    })
    for (const listener of Array.from(this.listeners)) listener(frame)
  }
}
