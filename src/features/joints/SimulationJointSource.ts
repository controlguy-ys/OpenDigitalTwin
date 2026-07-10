import {
  validateJointFrame,
  type JointAnglesDeg,
  type JointAngleSource,
  type JointFrame,
} from '../../domain/robot/joint-frame'

type JointFrameListener = (frame: JointFrame) => void

export class SimulationJointSource implements JointAngleSource {
  readonly mode = 'simulation' as const

  readonly #listeners = new Set<JointFrameListener>()

  connect(): Promise<void> {
    return Promise.resolve()
  }

  disconnect(): Promise<void> {
    return Promise.resolve()
  }

  subscribe(listener: JointFrameListener): () => void {
    this.#listeners.add(listener)
    return () => {
      this.#listeners.delete(listener)
    }
  }

  setAngles(anglesDeg: JointAnglesDeg, timestampMs = Date.now()): JointFrame {
    const receivedFrame: JointFrame = {
      anglesDeg,
      timestampMs,
      quality: 'GOOD',
    }
    validateJointFrame(receivedFrame)

    const frame: JointFrame = {
      anglesDeg: [
        anglesDeg[0],
        anglesDeg[1],
        anglesDeg[2],
        anglesDeg[3],
        anglesDeg[4],
        anglesDeg[5],
      ],
      timestampMs,
      quality: 'GOOD',
    }

    for (const listener of this.#listeners) {
      listener(frame)
    }

    return frame
  }
}
