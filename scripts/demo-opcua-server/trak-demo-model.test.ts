import { describe, expect, it } from 'vitest'

import {
  BUTTON_START,
  BUTTON_STOP,
  createTrakDemoModel,
  ROBOT_STATE_IDLE,
  ROBOT_STATE_MOVING,
} from './trak-demo-model.js'

describe('TrakDemo numeric model', () => {
  it('moves twenty evenly phased objects around the PLC stadium path', () => {
    const model = createTrakDemoModel()
    const initial = model.snapshot()

    expect(initial.objectPos).toHaveLength(20)
    expect(initial.objectPos[0]).toMatchObject({
      x: -600,
      y: 350,
      z: 180,
    })

    model.step()
    const next = model.snapshot()
    expect(next.objectPos[0]).toMatchObject({
      x: -572,
      y: 350,
    })
    expect(next.objectPosCli).toEqual(next.objectPos[0])
    expect(new Set(next.objectPos.map(({ x, y }) => `${x.toFixed(6)},${y.toFixed(6)}`)).size).toBe(20)
  })

  it('uses the PLC button commands and quintic robot pose interpolation', () => {
    const model = createTrakDemoModel()

    model.writeButton(BUTTON_START)
    model.step()
    const moving = model.snapshot()

    expect(moving.robot.status).toBe(ROBOT_STATE_MOVING)
    expect(moving.jobId).toBe(1)
    expect(moving.jobStatus[0]).toBe(1)
    expect(moving.robot.q1).toBeLessThan(0)
    expect(moving.robot.q1).toBeGreaterThan(-60)

    model.writeButton(BUTTON_STOP)
    model.step()
    const stopped = model.snapshot()
    expect(stopped.robot.status).toBe(ROBOT_STATE_IDLE)
    expect(stopped.jobId).toBe(0)
    expect(stopped.jobStatus.every((status) => status === 0)).toBe(true)
  })
})
