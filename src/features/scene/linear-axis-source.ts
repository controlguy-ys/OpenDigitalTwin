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

export interface LinearAxisCommittedStateV1 {
  readonly axisEntityId: string
  readonly configurationIdentity: string
  readonly positionM: number
  readonly homePositionM: number
}

export interface CommittedLinearAxisSourceV1 extends LinearAxisSourceV1 {
  synchronizeCommittedState(positionM: number, homePositionM: number): void
}

export interface ManualLinearAxisSourceOptions {
  readonly initialPositionM: number
  readonly homePositionM: number
  readonly commitPositionM: (positionM: number) => Promise<void>
  readonly commitHome?: () => Promise<void>
  readonly now?: () => number
  readonly onSubscriberError?: (error: unknown) => void
}

export class ManualLinearAxisSource implements CommittedLinearAxisSourceV1 {
  readonly kind = 'manual' as const
  private positionM: number
  private homePositionM: number
  private readonly commitPositionM: (positionM: number) => Promise<void>
  private readonly commitHome: (() => Promise<void>) | undefined
  private readonly now: () => number
  private readonly onSubscriberError: ((error: unknown) => void) | undefined
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
    this.onSubscriberError = options.onSubscriberError
  }

  subscribe(listener: (frame: LinearAxisFrameV1) => void): () => void {
    this.listeners.add(listener)
    this.publishTo(listener, this.goodFrame())
    return () => {
      this.listeners.delete(listener)
    }
  }

  synchronizeCommittedState(positionM: number, homePositionM: number): void {
    if (!Number.isFinite(positionM) || !Number.isFinite(homePositionM)) {
      throw new Error('LINEAR_AXIS_POSITION_INVALID: Manual positions must be finite.')
    }
    const positionChanged = this.positionM !== positionM
    this.positionM = positionM
    this.homePositionM = homePositionM
    if (positionChanged) this.publish(this.goodFrame())
  }

  async setPositionM(positionM: number): Promise<void> {
    if (!Number.isFinite(positionM)) {
      throw new Error('LINEAR_AXIS_POSITION_INVALID: Manual position must be finite.')
    }
    await this.commitPositionM(positionM)
    this.positionM = positionM
    this.publish(this.goodFrame())
  }

  private goodFrame(): LinearAxisFrameV1 {
    return Object.freeze({
      positionM: this.positionM,
      timestampMs: this.now(),
      quality: 'GOOD' as const,
    })
  }

  private publish(frame: LinearAxisFrameV1): void {
    for (const listener of Array.from(this.listeners)) this.publishTo(listener, frame)
  }

  private publishTo(
    listener: (frame: LinearAxisFrameV1) => void,
    frame: LinearAxisFrameV1,
  ): void {
    try {
      listener(frame)
    } catch (error) {
      try {
        this.onSubscriberError?.(error)
      } catch {
        // Subscriber diagnostics must not change committed command semantics.
      }
    }
  }

  async home(): Promise<void> {
    if (this.commitHome === undefined) {
      await this.setPositionM(this.homePositionM)
      return
    }
    await this.commitHome()
    this.positionM = this.homePositionM
    this.publish(this.goodFrame())
  }
}
